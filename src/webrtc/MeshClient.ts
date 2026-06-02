import { ICE_SERVERS, MEDIA_CONSTRAINTS, signalingUrl } from './config'
import { preferH264 } from './codec'
import type { ChatMessage, DevicePrefs, RemotePeer, Signal, Status } from './types'

/**
 * Framework-agnostic WebRTC **mesh** client.
 *
 * Every participant holds a direct RTCPeerConnection to every *other*
 * participant (a full mesh). The Rust signaling server (proxied at /ws) is a
 * dumb, identity-aware relay: it assigns each peer an id, tells newcomers who's
 * already in the room, and routes each SDP/ICE message to one specific peer.
 *
 * Role assignment (glare-free): whoever is *already* in the room when someone
 * joins receives "peer-joined" and becomes the offer initiator toward that
 * newcomer. The newcomer waits for offers. Because the server processes joins
 * one at a time, every pair has exactly one deterministic initiator.
 *
 * This class owns no React state — it emits a fresh immutable snapshot through
 * `onChange` whenever anything observable changes. A hook (or any UI) can
 * subscribe to render.
 */

// Everything we track per remote peer in the mesh.
type Peer = {
  pc: RTCPeerConnection
  channel: RTCDataChannel | null
  // ICE candidates that arrive before setRemoteDescription must be queued.
  pending: RTCIceCandidateInit[]
  name: string
  // Whether the peer is currently sending live video (camera on).
  videoOn: boolean
  // Senders are kept so we can replaceTrack (switch device, or release/restore
  // the camera) without renegotiation — even while the track is null.
  audioSender: RTCRtpSender | null
  videoSender: RTCRtpSender | null
  // Sender carrying our screen track to this peer while we present.
  screenSender: RTCRtpSender | null
  // Perfect-negotiation state (handles offer glare during renegotiation).
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  // Remote streams from this peer keyed by id (camera + optional screen).
  streams: Map<string, MediaStream>
  // Stream id this peer designated as their screen share, via the data channel.
  screenId: string | null
}


/** The observable snapshot the UI renders from. */
export type MeshState = {
  status: Status
  room: string
  myName: string
  messages: ChatMessage[]
  error: string | null
  localStream: MediaStream | null
  remotePeers: RemotePeer[]
  micOn: boolean
  cameraOn: boolean
  /** Currently active input devices (reflected by the in-call settings). */
  micId: string | null
  camId: string | null
  /** Chosen output device, applied to remote audio via setSinkId. */
  speakerId: string | null
  /** Our own server-assigned id (known once joined). */
  myId: number | null
  /** Id of the participant currently presenting, or null. */
  presenterId: number | null
  /** Our own screen-share stream while we present (drives the big view). */
  localScreenStream: MediaStream | null
  /** CaptureController for our active tab capture (Captured Surface Control). */
  screenController: CaptureController | null
}

export const initialMeshState: MeshState = {
  status: 'idle',
  room: '',
  myName: '',
  messages: [],
  error: null,
  localStream: null,
  remotePeers: [],
  micOn: true,
  cameraOn: true,
  micId: null,
  camId: null,
  speakerId: null,
  myId: null,
  presenterId: null,
  localScreenStream: null,
  screenController: null,
}

let messageCounter = 0
function newMessageId(): string {
  return `${Date.now()}-${messageCounter++}`
}

export class MeshClient {
  /** Subscribe here to receive a new snapshot on every change. */
  onChange: (state: MeshState) => void = () => {}

  private state: MeshState = { ...initialMeshState }

  // peer id -> Peer record. The heart of the mesh.
  private peers = new Map<number, Peer>()
  // Names learned from "joined"/"peer-joined" before a PC exists for that peer.
  private names = new Map<number, string>()
  private ws: WebSocket | null = null
  private localStream: MediaStream | null = null
  private prefs: DevicePrefs = {}
  // Guard against overlapping device switches (e.g. spamming the dropdown):
  // one in-flight switch per kind, with the latest pending choice coalesced.
  private switching: Record<'audio' | 'video', boolean> = { audio: false, video: false }
  private pendingDevice: Partial<Record<'audio' | 'video', string>> = {}

  // --- state plumbing ---------------------------------------------------

  private update(partial: Partial<MeshState>): void {
    this.state = { ...this.state, ...partial }
    this.onChange(this.state)
  }

  private addMessage(text: string, from: 'me' | 'peer', name?: string): void {
    this.update({
      messages: [...this.state.messages, { id: newMessageId(), text, from, name, at: Date.now() }],
    })
  }

  // Publish the current remote streams. A peer may expose two streams (camera
  // + screen); the screen is the one whose id the peer announced over the data
  // channel, the camera is the other.
  private syncRemotePeers(): void {
    const remotePeers: RemotePeer[] = []
    for (const [id, peer] of this.peers) {
      const screenStream = peer.screenId ? peer.streams.get(peer.screenId) ?? null : null
      const stream = [...peer.streams.values()].find((s) => s.id !== peer.screenId) ?? null
      remotePeers.push({ id, name: peer.name, stream, videoOn: peer.videoOn, screenStream })
    }
    this.update({ remotePeers })
  }

  // Derive the single overall status from the aggregate of all peer states.
  private recomputeStatus(): void {
    const peers = [...this.peers.values()]
    if (peers.length === 0) {
      // Alone in the room — stay parked on the waiting screen so others can join.
      const s = this.state.status
      this.update({ status: s === 'idle' || s === 'failed' ? s : 'waiting' })
      return
    }
    const states = peers.map((p) => p.pc.connectionState)
    if (states.some((s) => s === 'connected')) this.update({ status: 'connected' })
    else if (states.some((s) => s === 'failed')) this.update({ status: 'failed' })
    else this.update({ status: 'connecting' })
  }

  // --- signaling --------------------------------------------------------

  // Send a signaling payload to one specific peer via the relay.
  private sendSignal(to: number, signal: Signal): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'signal', to, data: signal }))
    }
  }

  // Wire up a data channel (created by the initiator, or received by the other).
  private setupChannel(peerId: number, channel: RTCDataChannel): void {
    const peer = this.peers.get(peerId)
    if (peer) peer.channel = channel
    channel.onopen = () => {
      // Tell this peer our current camera state so they render us correctly.
      channel.send(JSON.stringify({ kind: 'camera', on: this.state.cameraOn }))
      // If we're already presenting, let this (possibly late) peer know.
      if (this.state.presenterId === this.state.myId && this.state.localScreenStream) {
        channel.send(JSON.stringify({ kind: 'present', on: true, streamId: this.state.localScreenStream.id }))
      }
      this.recomputeStatus()
    }
    channel.onclose = () => this.recomputeStatus()
    channel.onmessage = (e) => {
      try {
        const data = JSON.parse(String(e.data))
        if (data.kind === 'camera') {
          const p = this.peers.get(peerId)
          if (p) p.videoOn = !!data.on
          this.syncRemotePeers()
        } else if (data.kind === 'present') {
          const p = this.peers.get(peerId)
          if (p) p.screenId = data.on ? String(data.streamId) : null
          this.update({
            presenterId: data.on ? peerId : this.state.presenterId === peerId ? null : this.state.presenterId,
          })
          this.syncRemotePeers()
        } else {
          // chat (kind:'chat' or legacy {text,name})
          this.addMessage(String(data.text), 'peer', data.name)
        }
      } catch {
        this.addMessage(String(e.data), 'peer')
      }
    }
  }

  // Create (or return existing) peer connection toward a given participant.
  private ensurePeer(peerId: number, name: string): Peer {
    const existing = this.peers.get(peerId)
    if (existing) return existing

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const peer: Peer = {
      pc,
      channel: null,
      pending: [],
      name,
      videoOn: true,
      audioSender: null,
      videoSender: null,
      screenSender: null,
      // Deterministic, opposite on each side of the pair → glare-free.
      polite: this.state.myId != null ? this.state.myId > peerId : false,
      makingOffer: false,
      ignoreOffer: false,
      streams: new Map(),
      screenId: null,
    }
    this.peers.set(peerId, peer)

    // Trickle ICE: ship each candidate to *this* peer as it's found.
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log(`%c[ICE] local candidate → peer ${peerId}`, 'color:#6ee7a8', e.candidate.candidate)
        this.sendSignal(peerId, { kind: 'ice', candidate: e.candidate.toJSON() })
      } else {
        console.log(`%c[ICE] gathering complete for peer ${peerId}`, 'color:#ffd27a;font-weight:bold')
      }
    }

    // Perfect negotiation: any track add/remove (initial setup, screen share)
    // fires this; we create an offer guarded by makingOffer so glare is safe.
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true
        await pc.setLocalDescription()
        if (pc.localDescription) {
          this.sendSignal(peerId, {
            kind: 'sdp',
            description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
          })
        }
      } catch (err) {
        console.warn(`[NEG] negotiation failed for peer ${peerId}`, err)
      } finally {
        peer.makingOffer = false
      }
    }

    pc.onconnectionstatechange = () => {
      console.log(`%c[PC ${peerId}] connection state: ${pc.connectionState}`, 'color:#4f8cff;font-weight:bold')
      this.recomputeStatus()
    }

    // Track remote streams by id; a peer may expose camera + screen. Camera
    // on/off is signalled over the data channel (the track's `muted` flag is
    // unreliable), and which stream is the screen is announced there too.
    pc.ontrack = (e) => {
      console.log(`%c[MEDIA] remote ${e.track.kind} from peer ${peerId}`, 'color:#6ee7a8;font-weight:bold')
      const stream = e.streams[0]
      if (stream) peer.streams.set(stream.id, stream)
      this.syncRemotePeers()
    }

    // The non-initiator learns about the data channel here.
    pc.ondatachannel = (e) => this.setupChannel(peerId, e.channel)

    // Reserve audio + video senders up front. Keeping the senders (even with a
    // null track when the camera is off) lets us switch devices and turn the
    // camera on/off later via replaceTrack — no renegotiation, and it works for
    // peers who join while our camera is off.
    const stream = this.localStream
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0]
      if (audioTrack) peer.audioSender = pc.addTrack(audioTrack, stream)

      const videoTrack = stream.getVideoTracks()[0]
      if (videoTrack) {
        peer.videoSender = pc.addTrack(videoTrack, stream)
        const tr = pc.getTransceivers().find((t) => t.sender === peer.videoSender)
        if (tr) preferH264(tr)
      } else {
        // Camera off: reserve an empty video sender, tagging it with our stream
        // id so the receiver groups the track when we later replaceTrack it in.
        const tr = pc.addTransceiver('video', { direction: 'sendrecv', streams: [stream] })
        peer.videoSender = tr.sender
        preferH264(tr)
      }
    }

    return peer
  }

  private async flushCandidates(peer: Peer): Promise<void> {
    for (const candidate of peer.pending) {
      try {
        await peer.pc.addIceCandidate(candidate)
      } catch (err) {
        console.warn('[ICE] failed to add queued candidate', err)
      }
    }
    peer.pending = []
  }

  // Handle a signaling payload relayed from a specific peer, using the perfect-
  // negotiation pattern so renegotiation (screen share) can't deadlock on glare.
  private async handleSignal(from: number, signal: Signal): Promise<void> {
    const name = this.names.get(from) ?? `Peer ${from}`
    const peer = this.ensurePeer(from, name)
    const pc = peer.pc

    if (signal.kind === 'sdp') {
      const desc = signal.description
      console.log(`%c[SDP] remote ${desc.type} from peer ${from}`, 'color:#a06bff;font-weight:bold')
      const collision = desc.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable')
      peer.ignoreOffer = !peer.polite && collision
      if (peer.ignoreOffer) {
        console.log(`%c[NEG] ignoring colliding offer from peer ${from} (impolite)`, 'color:#ff8a8a')
        return
      }
      await pc.setRemoteDescription(desc) // implicit rollback on polite collision
      await this.flushCandidates(peer)
      if (desc.type === 'offer') {
        await pc.setLocalDescription() // implicit answer
        if (pc.localDescription) {
          console.log(`%c[SDP] local answer → peer ${from}`, 'color:#4f8cff;font-weight:bold')
          this.sendSignal(from, {
            kind: 'sdp',
            description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
          })
        }
      }
    } else if (signal.kind === 'ice') {
      // Can only add a candidate after the remote description exists.
      if (pc.remoteDescription) {
        try {
          await pc.addIceCandidate(signal.candidate)
        } catch (err) {
          if (!peer.ignoreOffer) console.warn('[ICE] failed to add candidate', err)
        }
      } else {
        peer.pending.push(signal.candidate)
      }
    }
  }

  // We were here first → kick off the connection to a newcomer. Creating the
  // data channel (plus the tracks added in ensurePeer) triggers
  // onnegotiationneeded, which produces the initial offer.
  private initiateTo(peerId: number, name: string): void {
    console.log(`%c[SIGNAL] peer ${peerId} joined — initiating`, 'color:#4f8cff;font-weight:bold')
    const peer = this.ensurePeer(peerId, name)
    const channel = peer.pc.createDataChannel('chat')
    this.setupChannel(peerId, channel)
    this.update({ status: 'connecting' })
  }

  // Tear down a single peer (it left, or we're leaving).
  private dropPeer(peerId: number): void {
    const peer = this.peers.get(peerId)
    if (!peer) return
    peer.channel?.close()
    peer.pc.close()
    this.peers.delete(peerId)
    this.names.delete(peerId)
    // If the leaver was presenting, drop back to the normal grid.
    const presenterId = this.state.presenterId === peerId ? null : this.state.presenterId
    this.update({ presenterId })
    this.syncRemotePeers()
    this.recomputeStatus()
  }

  // Build a video constraint for the currently chosen camera (the in-call
  // selection if any, else the pre-join choice, else the default).
  private videoConstraint(): MediaTrackConstraints {
    const camId = this.state.camId ?? this.prefs.camId
    return camId
      ? { ...(MEDIA_CONSTRAINTS.video as MediaTrackConstraints), deviceId: { exact: camId } }
      : (MEDIA_CONSTRAINTS.video as MediaTrackConstraints)
  }

  // Grab mic (always) + camera (only if joining with it on). Honour the devices
  // chosen on the pre-join screen, falling back to the defaults. Leaving the
  // camera off means we never open it — no capture, no indicator light.
  private async startLocalMedia(): Promise<void> {
    const micOn = this.prefs.micOn !== false
    const cameraOn = this.prefs.camOn !== false

    const constraints: MediaStreamConstraints = {
      audio: this.prefs.micId
        ? { ...(MEDIA_CONSTRAINTS.audio as MediaTrackConstraints), deviceId: { exact: this.prefs.micId } }
        : MEDIA_CONSTRAINTS.audio,
      video: cameraOn ? this.videoConstraint() : false,
    }
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    stream.getTracks().forEach((track) => {
      console.groupCollapsed(`%c[MEDIA] local ${track.kind} track`, 'color:#4f8cff')
      console.log('Constraints:', track.getConstraints())
      console.log('Settings:', track.getSettings())
      console.log('Capabilities:', track.getCapabilities?.())
      console.groupEnd()
    })

    // The mic is always captured (so unmuting is instant); it just starts
    // disabled if requested. The camera, by contrast, isn't even opened above
    // when off.
    stream.getAudioTracks().forEach((t) => (t.enabled = micOn))

    this.localStream = stream
    this.update({
      localStream: stream,
      micOn,
      cameraOn,
      micId: this.prefs.micId ?? stream.getAudioTracks()[0]?.getSettings().deviceId ?? null,
      camId: this.prefs.camId ?? stream.getVideoTracks()[0]?.getSettings().deviceId ?? null,
    })
  }

  // --- public API -------------------------------------------------------

  async joinRoom(roomId: string, name: string, prefs: DevicePrefs = {}): Promise<void> {
    const code = roomId.trim()
    const displayName = name.trim()
    if (!code || !displayName) return
    this.prefs = prefs
    try {
      this.update({
        error: null,
        room: code,
        myName: displayName,
        messages: [],
        remotePeers: [],
        status: 'waiting',
        speakerId: prefs.speakerId ?? null,
      })

      // Capture media up front so tracks are present before any negotiation.
      await this.startLocalMedia()

      const ws = new WebSocket(signalingUrl())
      this.ws = ws

      ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room: code, name: displayName }))

      ws.onmessage = async (ev) => {
        const msg = JSON.parse(ev.data)
        switch (msg.type) {
          case 'joined': {
            // The peers ALREADY here will each offer to us; we just wait.
            const peers: { id: number; name: string }[] = msg.peers ?? []
            console.log(`%c[SIGNAL] joined room '${code}' as id ${msg.you} (${peers.length} already here)`, 'color:#9aa3b2')
            for (const p of peers) this.names.set(p.id, p.name)
            this.update({ myId: msg.you, status: peers.length > 0 ? 'connecting' : 'waiting' })
            break
          }

          case 'peer-joined': {
            // We were here first → we initiate toward the newcomer.
            this.names.set(msg.id, msg.name)
            this.initiateTo(msg.id, msg.name)
            break
          }

          case 'signal':
            await this.handleSignal(msg.from as number, msg.data as Signal)
            break

          case 'peer-left':
            console.log(`%c[SIGNAL] peer ${msg.id} left`, 'color:#ff8a8a')
            this.dropPeer(msg.id as number)
            break

          case 'error':
            this.update({ error: msg.message ?? 'Signaling error', status: 'failed' })
            break
        }
      }

      ws.onerror = () => {
        this.update({
          error: 'Could not reach the signaling server. Is it running on port 3000?',
          status: 'failed',
        })
      }
    } catch (err) {
      this.update({ error: (err as Error).message, status: 'failed' })
    }
  }

  // Broadcast a chat message over every open data channel.
  sendMessage(text: string): void {
    const payload = JSON.stringify({ kind: 'chat', text, name: this.state.myName })
    let sent = false
    for (const peer of this.peers.values()) {
      if (peer.channel && peer.channel.readyState === 'open') {
        peer.channel.send(payload)
        sent = true
      }
    }
    if (sent) this.addMessage(text, 'me')
  }

  toggleMic(): void {
    const stream = this.localStream
    if (!stream) return
    const next = !this.state.micOn
    stream.getAudioTracks().forEach((t) => (t.enabled = next))
    this.update({ micOn: next })
  }

  // Tell every peer our camera state so they swap to/from our avatar.
  private broadcastCamera(on: boolean): void {
    const payload = JSON.stringify({ kind: 'camera', on })
    for (const peer of this.peers.values()) {
      if (peer.channel && peer.channel.readyState === 'open') peer.channel.send(payload)
    }
  }

  /**
   * Turn the camera fully off (release the device — light goes out) or back on.
   * Off detaches the track from every reserved video sender and stops it; on
   * re-opens the camera and re-attaches via replaceTrack — no renegotiation.
   */
  async toggleCamera(): Promise<void> {
    const stream = this.localStream
    if (!stream) return
    const turnOn = !this.state.cameraOn

    if (turnOn) {
      let track: MediaStreamTrack | undefined
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ video: this.videoConstraint() })
        track = tmp.getVideoTracks()[0]
      } catch (err) {
        console.warn('[CAMERA] could not start camera', err)
        return
      }
      if (!track) return
      for (const peer of this.peers.values()) {
        if (peer.videoSender) await peer.videoSender.replaceTrack(track)
      }
      stream.addTrack(track)
      this.update({ cameraOn: true, camId: track.getSettings().deviceId ?? this.state.camId })
    } else {
      for (const peer of this.peers.values()) {
        if (peer.videoSender) await peer.videoSender.replaceTrack(null)
      }
      const old = stream.getVideoTracks()[0]
      if (old) {
        stream.removeTrack(old)
        old.stop()
      }
      this.update({ cameraOn: false })
    }

    this.broadcastCamera(turnOn)
  }

  /**
   * Swap the active camera or microphone mid-call. Captures a fresh track from
   * the chosen device and `replaceTrack`s it on every peer's reserved sender —
   * no SDP renegotiation needed. The current on/off state is preserved.
   *
   * Overlapping calls (e.g. spamming the dropdown) are coalesced: only one
   * switch per kind runs at a time, and the latest pending choice is applied
   * afterwards, so we never double-capture or leave senders inconsistent.
   */
  private async switchTrack(kind: 'audio' | 'video', deviceId: string): Promise<void> {
    if (this.switching[kind]) {
      this.pendingDevice[kind] = deviceId
      return
    }
    this.switching[kind] = true
    try {
      const stream = this.localStream
      if (!stream) return

      // Choosing a camera while it's off just records the choice; the device is
      // opened when the camera is turned back on (so we don't power it up here).
      if (kind === 'video' && !this.state.cameraOn) {
        this.update({ camId: deviceId })
        return
      }

      const constraints: MediaStreamConstraints =
        kind === 'video'
          ? { video: { ...(MEDIA_CONSTRAINTS.video as MediaTrackConstraints), deviceId: { exact: deviceId } } }
          : { audio: { ...(MEDIA_CONSTRAINTS.audio as MediaTrackConstraints), deviceId: { exact: deviceId } } }
      const tmp = await navigator.mediaDevices.getUserMedia(constraints)
      const next = kind === 'video' ? tmp.getVideoTracks()[0] : tmp.getAudioTracks()[0]
      if (!next) return
      next.enabled = kind === 'video' ? this.state.cameraOn : this.state.micOn

      // Point every peer's reserved sender at the new track.
      for (const peer of this.peers.values()) {
        const sender = kind === 'video' ? peer.videoSender : peer.audioSender
        if (sender) await sender.replaceTrack(next)
      }

      // Swap it into the local stream too (drives our own preview tile).
      const old = kind === 'video' ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0]
      if (old) {
        stream.removeTrack(old)
        old.stop()
      }
      stream.addTrack(next)

      this.update(kind === 'video' ? { camId: deviceId } : { micId: deviceId })
    } catch (err) {
      console.warn(`[DEVICE] could not switch ${kind}`, err)
    } finally {
      this.switching[kind] = false
      const queued = this.pendingDevice[kind]
      this.pendingDevice[kind] = undefined
      if (queued !== undefined && queued !== deviceId) void this.switchTrack(kind, queued)
    }
  }

  switchCamera(deviceId: string): Promise<void> {
    return this.switchTrack('video', deviceId)
  }

  switchMicrophone(deviceId: string): Promise<void> {
    return this.switchTrack('audio', deviceId)
  }

  /** Route remote audio to a different output device (where supported). */
  setSpeaker(deviceId: string): void {
    this.update({ speakerId: deviceId })
  }

  // Tell every peer whether we're presenting (and which stream is the screen).
  private broadcastPresent(on: boolean, streamId?: string): void {
    const payload = JSON.stringify({ kind: 'present', on, streamId })
    for (const peer of this.peers.values()) {
      if (peer.channel && peer.channel.readyState === 'open') peer.channel.send(payload)
    }
  }

  /**
   * Start sharing the screen. The screen is added as a *separate* track to each
   * peer (so the camera keeps flowing), which renegotiates via perfect
   * negotiation. A CaptureController is attached for Captured Surface Control.
   * Only one participant may present at a time.
   */
  async startScreenShare(): Promise<void> {
    if (this.state.presenterId != null && this.state.presenterId !== this.state.myId) return
    if (this.state.localScreenStream) return
    let stream: MediaStream
    const controller =
      typeof window !== 'undefined' && window.CaptureController ? new CaptureController() : undefined
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false, controller })
    } catch (err) {
      console.warn('[SCREEN] share cancelled/failed', err)
      return
    }
    const track = stream.getVideoTracks()[0]
    if (!track) return
    // The browser's own "Stop sharing" control ends the track.
    track.onended = () => void this.stopScreenShare()

    for (const peer of this.peers.values()) {
      peer.screenSender = peer.pc.addTrack(track, stream) // → onnegotiationneeded
    }

    this.update({
      presenterId: this.state.myId,
      localScreenStream: stream,
      screenController: controller ?? null,
    })
    this.broadcastPresent(true, stream.id)
  }

  /** Stop our screen share and revert everyone to the normal grid. */
  async stopScreenShare(): Promise<void> {
    if (!this.state.localScreenStream) return
    for (const peer of this.peers.values()) {
      if (peer.screenSender) {
        peer.pc.removeTrack(peer.screenSender) // → onnegotiationneeded
        peer.screenSender = null
      }
    }
    this.state.localScreenStream.getTracks().forEach((t) => t.stop())
    this.update({
      presenterId: this.state.presenterId === this.state.myId ? null : this.state.presenterId,
      localScreenStream: null,
      screenController: null,
    })
    this.broadcastPresent(false)
  }

  leaveRoom(): void {
    this.state.localScreenStream?.getTracks().forEach((t) => t.stop())
    this.localStream?.getTracks().forEach((t) => t.stop())
    this.localStream?.getTracks().forEach((t) => t.stop())
    for (const peer of this.peers.values()) {
      peer.channel?.close()
      peer.pc.close()
    }
    this.peers.clear()
    this.names.clear()
    this.ws?.close()
    this.ws = null
    this.localStream = null
    this.update({ ...initialMeshState })
  }
}
