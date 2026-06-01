import { useCallback, useRef, useState } from 'react'

/**
 * WebRTC **mesh** call hook using a WebSocket signaling server.
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
 */

export type ChatMessage = {
  id: string
  text: string
  from: 'me' | 'peer'
  /** Display name of the sender (for peer messages). */
  name?: string
  at: number
}

export type Status =
  | 'idle'
  | 'waiting' // in a room, alone — waiting for others
  | 'connecting' // negotiating offer/answer/ICE with at least one peer
  | 'connected' // at least one peer connection is up
  | 'disconnected'
  | 'failed'

/** A remote participant's live video/audio plus their display name. */
export type RemotePeer = {
  id: number
  name: string
  stream: MediaStream
  /** False when the peer's camera track is muted/off (show an avatar instead). */
  videoOn: boolean
}

const ICE_SERVERS: RTCIceServer[] = [
  // Public STUN server lets peers discover their public IP so the connection
  // can work across different networks (not just localhost / same LAN).
  { urls: 'stun:stun.l.google.com:19302' },
]

interface ExtendedAudioConstraints extends MediaTrackConstraints {
  latency?: ConstrainDouble;
  echoCancellationType?: 'browser' | 'system';
  suppressLocalAudioPlayback?: boolean;
}

const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 }
  },
  audio: {
    sampleRate: { ideal: 48000 },
    echoCancellation: { ideal: true },
    autoGainControl: { ideal: true },
    noiseSuppression: { ideal: true },
    latency: { ideal: 0 },
    echoCancellationType: 'system',
    channelCount: { ideal: 2 },
    deviceId: { exact: 'default' },
    // suppressLocalAudioPlayback: true,
    voiceIsolation:true,
  } as ExtendedAudioConstraints
};

// The page is served over HTTPS by Vite, which proxies "/ws" to the Rust
// signaling server. Using the same origin (wss + current host) means the
// browser reuses the TLS cert it already trusts — no extra cert prompt.
function signalingUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

let messageCounter = 0
function newMessageId(): string {
  return `${Date.now()}-${messageCounter++}`
}

// Prefer H.264 for video. This machine only has *hardware* encoders for H.264
// (and HEVC); the WebRTC default VP8 falls back to a software encoder, which
// pegs the CPU and heats the laptop — especially in a mesh where each tab
// encodes its camera once per peer. Reordering codecs so H.264 is first makes
// both ends negotiate it, engaging the GPU encoder/decoder.
function preferH264(transceiver: RTCRtpTransceiver): void {
  const caps = RTCRtpReceiver.getCapabilities?.('video')
  if (!caps || typeof transceiver.setCodecPreferences !== 'function') return
  const rank = (c: { mimeType: string }) => (c.mimeType.toLowerCase() === 'video/h264' ? 0 : 1)
  const ordered = [...caps.codecs].sort((a, b) => rank(a) - rank(b))
  try {
    transceiver.setCodecPreferences(ordered)
  } catch (err) {
    console.warn('[CODEC] could not set H.264 preference', err)
  }
}

// Signal payloads we send through the relay (wrapped in {type:'signal',to,data:...}).
type SdpSignal = { kind: 'sdp'; description: RTCSessionDescriptionInit }
type IceSignal = { kind: 'ice'; candidate: RTCIceCandidateInit }
type Signal = SdpSignal | IceSignal

// Everything we track per remote peer in the mesh.
type Peer = {
  pc: RTCPeerConnection
  channel: RTCDataChannel | null
  // ICE candidates that arrive before setRemoteDescription must be queued.
  pending: RTCIceCandidateInit[]
  name: string
  // Whether the peer is currently sending live video (camera on).
  videoOn: boolean
}

export function useWebRTC() {
  const [status, setStatus] = useState<Status>('idle')
  const [room, setRoom] = useState('')
  const [myName, setMyName] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  // One entry per connected remote participant — drives the video grid.
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([])
  const [micOn, setMicOn] = useState(true)
  const [cameraOn, setCameraOn] = useState(true)

  // peer id -> Peer record. The heart of the mesh.
  const peersRef = useRef<Map<number, Peer>>(new Map())
  // Names learned from "joined"/"peer-joined" before a PC exists for that peer.
  const namesRef = useRef<Map<number, string>>(new Map())
  const wsRef = useRef<WebSocket | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const myNameRef = useRef('')
  // Current camera state, readable inside callbacks (state is async).
  const cameraOnRef = useRef(true)

  const addMessage = useCallback(
    (text: string, from: 'me' | 'peer', name?: string) => {
      setMessages((prev) => [...prev, { id: newMessageId(), text, from, name, at: Date.now() }])
    },
    [],
  )

  // Publish the current remote video streams to React state.
  const syncRemotePeers = useCallback(() => {
    const peers: RemotePeer[] = []
    for (const [id, peer] of peersRef.current) {
      const stream = (peer.pc as RTCPeerConnection & { _remoteStream?: MediaStream })._remoteStream
      if (stream) peers.push({ id, name: peer.name, stream, videoOn: peer.videoOn })
    }
    setRemotePeers(peers)
  }, [])

  // Derive the single overall status from the aggregate of all peer states.
  const recomputeStatus = useCallback(() => {
    const peers = [...peersRef.current.values()]
    if (peers.length === 0) {
      // Alone in the room — stay parked on the waiting screen so others can join.
      setStatus((s) => (s === 'idle' || s === 'failed' ? s : 'waiting'))
      return
    }
    const states = peers.map((p) => p.pc.connectionState)
    if (states.some((s) => s === 'connected')) setStatus('connected')
    else if (states.some((s) => s === 'failed')) setStatus('failed')
    else setStatus('connecting')
  }, [])

  // Send a signaling payload to one specific peer via the relay.
  const sendSignal = useCallback((to: number, signal: Signal) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'signal', to, data: signal }))
    }
  }, [])

  // Wire up a data channel (created by the initiator, or received by the other).
  const setupChannel = useCallback(
    (peerId: number, channel: RTCDataChannel) => {
      const peer = peersRef.current.get(peerId)
      if (peer) peer.channel = channel
      channel.onopen = () => {
        // Tell this peer our current camera state so they render us correctly.
        channel.send(JSON.stringify({ kind: 'camera', on: cameraOnRef.current }))
        recomputeStatus()
      }
      channel.onclose = () => recomputeStatus()
      channel.onmessage = (e) => {
        try {
          const data = JSON.parse(String(e.data))
          if (data.kind === 'camera') {
            const p = peersRef.current.get(peerId)
            if (p) p.videoOn = !!data.on
            syncRemotePeers()
          } else {
            // chat (kind:'chat' or legacy {text,name})
            addMessage(String(data.text), 'peer', data.name)
          }
        } catch {
          addMessage(String(e.data), 'peer')
        }
      }
    },
    [addMessage, recomputeStatus, syncRemotePeers],
  )

  // Create (or return existing) peer connection toward a given participant.
  const ensurePeer = useCallback(
    (peerId: number, name: string): Peer => {
      const existing = peersRef.current.get(peerId)
      if (existing) return existing

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      const peer: Peer = { pc, channel: null, pending: [], name, videoOn: true }
      peersRef.current.set(peerId, peer)

      // Trickle ICE: ship each candidate to *this* peer as it's found.
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          console.log(`%c[ICE] local candidate → peer ${peerId}`, 'color:#6ee7a8', e.candidate.candidate)
          sendSignal(peerId, { kind: 'ice', candidate: e.candidate.toJSON() })
        } else {
          console.log(`%c[ICE] gathering complete for peer ${peerId}`, 'color:#ffd27a;font-weight:bold')
        }
      }

      pc.onconnectionstatechange = () => {
        console.log(`%c[PC ${peerId}] connection state: ${pc.connectionState}`, 'color:#4f8cff;font-weight:bold')
        recomputeStatus()
      }

      // Remote audio + video tracks for this peer share one MediaStream.
      // Camera on/off is signalled explicitly over the data channel (see
      // setupChannel) — the remote track's `muted` flag is unreliable for this.
      pc.ontrack = (e) => {
        console.log(`%c[MEDIA] remote ${e.track.kind} from peer ${peerId}`, 'color:#6ee7a8;font-weight:bold')
        ;(pc as RTCPeerConnection & { _remoteStream?: MediaStream })._remoteStream = e.streams[0]
        syncRemotePeers()
      }

      // The non-initiator learns about the data channel here.
      pc.ondatachannel = (e) => setupChannel(peerId, e.channel)

      // Attach our local tracks so this peer receives our camera + mic.
      const stream = localStreamRef.current
      if (stream) {
        stream.getTracks().forEach((track) => {
          const sender = pc.addTrack(track, stream)
          // Steer video negotiation toward the GPU-accelerated H.264 encoder.
          if (track.kind === 'video') {
            const transceiver = pc.getTransceivers().find((t) => t.sender === sender)
            if (transceiver) preferH264(transceiver)
          }
        })
      }

      return peer
    },
    [recomputeStatus, sendSignal, setupChannel, syncRemotePeers],
  )

  const flushCandidates = useCallback(async (peer: Peer) => {
    for (const candidate of peer.pending) {
      try {
        await peer.pc.addIceCandidate(candidate)
      } catch (err) {
        console.warn('[ICE] failed to add queued candidate', err)
      }
    }
    peer.pending = []
  }, [])

  // Handle a signaling payload relayed from a specific peer.
  const handleSignal = useCallback(
    async (from: number, signal: Signal) => {
      const name = namesRef.current.get(from) ?? `Peer ${from}`
      const peer = ensurePeer(from, name)
      const pc = peer.pc

      if (signal.kind === 'sdp') {
        console.log(`%c[SDP] remote ${signal.description.type} from peer ${from}`, 'color:#a06bff;font-weight:bold')
        await pc.setRemoteDescription(signal.description)
        await flushCandidates(peer)

        // If we received an offer, answer it.
        if (signal.description.type === 'offer') {
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          console.log(`%c[SDP] local answer → peer ${from}`, 'color:#4f8cff;font-weight:bold')
          sendSignal(from, { kind: 'sdp', description: { type: answer.type, sdp: answer.sdp } })
        }
      } else if (signal.kind === 'ice') {
        // Can only add a candidate after the remote description exists.
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(signal.candidate)
          } catch (err) {
            console.warn('[ICE] failed to add candidate', err)
          }
        } else {
          peer.pending.push(signal.candidate)
        }
      }
    },
    [ensurePeer, flushCandidates, sendSignal],
  )

  // We were here first → initiate the offer toward a newcomer.
  const initiateTo = useCallback(
    async (peerId: number, name: string) => {
      console.log(`%c[SIGNAL] peer ${peerId} joined — initiating offer`, 'color:#4f8cff;font-weight:bold')
      const peer = ensurePeer(peerId, name)
      const channel = peer.pc.createDataChannel('chat')
      setupChannel(peerId, channel)
      const offer = await peer.pc.createOffer()
      await peer.pc.setLocalDescription(offer)
      sendSignal(peerId, { kind: 'sdp', description: { type: offer.type, sdp: offer.sdp } })
      setStatus('connecting')
    },
    [ensurePeer, sendSignal, setupChannel],
  )

  // Tear down a single peer (it left, or we're leaving).
  const dropPeer = useCallback(
    (peerId: number) => {
      const peer = peersRef.current.get(peerId)
      if (!peer) return
      peer.channel?.close()
      peer.pc.close()
      peersRef.current.delete(peerId)
      namesRef.current.delete(peerId)
      syncRemotePeers()
      recomputeStatus()
    },
    [recomputeStatus, syncRemotePeers],
  )

  // Grab camera + mic ONCE; the same tracks are shared to every peer.
  const startLocalMedia = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS)
    stream.getTracks().forEach((track) => {
      console.groupCollapsed(`%c[MEDIA] local ${track.kind} track`, 'color:#4f8cff')
      console.log('Constraints:', track.getConstraints())
      console.log('Settings:', track.getSettings())
      console.log('Capabilities:', track.getCapabilities?.())
      console.groupEnd()
    })
    localStreamRef.current = stream
    setLocalStream(stream)
    setMicOn(true)
    setCameraOn(true)
    cameraOnRef.current = true
  }, [])

  const joinRoom = useCallback(
    async (roomId: string, name: string) => {
      const code = roomId.trim()
      const displayName = name.trim()
      if (!code || !displayName) return
      try {
        setError(null)
        setRoom(code)
        setMyName(displayName)
        myNameRef.current = displayName
        setMessages([])
        setRemotePeers([])
        setStatus('waiting')

        // Capture media up front so tracks are present before any negotiation.
        await startLocalMedia()

        const ws = new WebSocket(signalingUrl())
        wsRef.current = ws

        ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room: code, name: displayName }))

        ws.onmessage = async (ev) => {
          const msg = JSON.parse(ev.data)
          switch (msg.type) {
            case 'joined': {
              // The peers ALREADY here will each offer to us; we just wait.
              const peers: { id: number; name: string }[] = msg.peers ?? []
              console.log(`%c[SIGNAL] joined room '${code}' as id ${msg.you} (${peers.length} already here)`, 'color:#9aa3b2')
              for (const p of peers) namesRef.current.set(p.id, p.name)
              setStatus(peers.length > 0 ? 'connecting' : 'waiting')
              break
            }

            case 'peer-joined': {
              // We were here first → we initiate toward the newcomer.
              namesRef.current.set(msg.id, msg.name)
              await initiateTo(msg.id, msg.name)
              break
            }

            case 'signal':
              await handleSignal(msg.from as number, msg.data as Signal)
              break

            case 'peer-left':
              console.log(`%c[SIGNAL] peer ${msg.id} left`, 'color:#ff8a8a')
              dropPeer(msg.id as number)
              break

            case 'error':
              setError(msg.message ?? 'Signaling error')
              setStatus('failed')
              break
          }
        }

        ws.onerror = () => {
          setError('Could not reach the signaling server. Is it running on port 9000?')
          setStatus('failed')
        }
      } catch (err) {
        setError((err as Error).message)
        setStatus('failed')
      }
    },
    [startLocalMedia, initiateTo, handleSignal, dropPeer],
  )

  // Broadcast a chat message over every open data channel.
  const sendMessage = useCallback(
    (text: string) => {
      const payload = JSON.stringify({ kind: 'chat', text, name: myNameRef.current })
      let sent = false
      for (const peer of peersRef.current.values()) {
        if (peer.channel && peer.channel.readyState === 'open') {
          peer.channel.send(payload)
          sent = true
        }
      }
      if (sent) addMessage(text, 'me')
    },
    [addMessage],
  )

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current
    if (!stream) return
    const next = !micOn
    stream.getAudioTracks().forEach((t) => (t.enabled = next))
    setMicOn(next)
  }, [micOn])

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current
    if (!stream) return
    const next = !cameraOn
    stream.getVideoTracks().forEach((t) => (t.enabled = next))
    cameraOnRef.current = next
    setCameraOn(next)
    // Let every peer know so they swap to/from our avatar.
    const payload = JSON.stringify({ kind: 'camera', on: next })
    for (const peer of peersRef.current.values()) {
      if (peer.channel && peer.channel.readyState === 'open') peer.channel.send(payload)
    }
  }, [cameraOn])

  const leaveRoom = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    for (const peer of peersRef.current.values()) {
      peer.channel?.close()
      peer.pc.close()
    }
    peersRef.current.clear()
    namesRef.current.clear()
    wsRef.current?.close()
    wsRef.current = null
    localStreamRef.current = null
    myNameRef.current = ''
    cameraOnRef.current = true
    setStatus('idle')
    setRoom('')
    setMyName('')
    setMessages([])
    setError(null)
    setLocalStream(null)
    setRemotePeers([])
    setMicOn(true)
    setCameraOn(true)
  }, [])

  return {
    status,
    room,
    myName,
    messages,
    error,
    localStream,
    remotePeers,
    micOn,
    cameraOn,
    joinRoom,
    sendMessage,
    toggleMic,
    toggleCamera,
    leaveRoom,
  }
}
