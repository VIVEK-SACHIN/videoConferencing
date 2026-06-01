import { useCallback, useRef, useState } from 'react'

/**
 * WebRTC peer-to-peer call hook using a WebSocket signaling server.
 *
 * Instead of copy-pasting SDP by hand, both peers join a room on the Rust
 * signaling server (proxied at /ws). The server relays messages between the two
 * peers in a room so they can exchange:
 *   1. SDP offer/answer — describing media + transport.
 *   2. ICE candidates — network routes, sent incrementally ("trickle ICE")
 *      as the browser discovers them, instead of waiting for all of them.
 *
 * Role assignment: whoever is *already* in the room when a second peer joins
 * receives "peer-joined" and becomes the offer initiator. The newcomer waits
 * for the offer. This gives a deterministic caller/callee split (no glare).
 */

export type ChatMessage = {
  id: string
  text: string
  from: 'me' | 'peer'
  at: number
}

export type Status =
  | 'idle'
  | 'waiting' // in a room, waiting for the other peer
  | 'connecting' // negotiating offer/answer/ICE
  | 'connected'
  | 'disconnected'
  | 'failed'

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

// Signal payloads we send through the relay (wrapped in {type:'signal',data:...}).
type SdpSignal = { kind: 'sdp'; description: RTCSessionDescriptionInit }
type IceSignal = { kind: 'ice'; candidate: RTCIceCandidateInit }
type Signal = SdpSignal | IceSignal

export function useWebRTC() {
  const [status, setStatus] = useState<Status>('idle')
  const [room, setRoom] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [micOn, setMicOn] = useState(true)
  const [cameraOn, setCameraOn] = useState(true)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const channelRef = useRef<RTCDataChannel | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  // ICE candidates that arrive before we've set the remote description must be
  // queued, then applied once setRemoteDescription succeeds.
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([])

  const addMessage = useCallback((text: string, from: 'me' | 'peer') => {
    setMessages((prev) => [...prev, { id: newMessageId(), text, from, at: Date.now() }])
  }, [])

  // Send a signaling payload to the peer via the relay.
  const sendSignal = useCallback((signal: Signal) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'signal', data: signal }))
    }
  }, [])

  // Wire up a data channel (created by the initiator, or received by the other).
  const setupChannel = useCallback(
    (channel: RTCDataChannel) => {
      channelRef.current = channel
      channel.onopen = () => setStatus('connected')
      channel.onclose = () => setStatus('disconnected')
      channel.onmessage = (e) => addMessage(String(e.data), 'peer')
    },
    [addMessage],
  )

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

    // Trickle ICE: ship each candidate to the peer the moment it's found.
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log('%c[ICE] local candidate → peer', 'color:#6ee7a8', e.candidate.candidate)
        sendSignal({ kind: 'ice', candidate: e.candidate.toJSON() })
      } else {
        console.log('%c[ICE] gathering complete', 'color:#ffd27a;font-weight:bold')
      }
    }

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      console.log(`%c[PC] connection state: ${s}`, 'color:#4f8cff;font-weight:bold')
      if (s === 'connecting') setStatus('connecting')
      else if (s === 'connected') setStatus('connected')
      else if (s === 'disconnected' || s === 'closed') setStatus('disconnected')
      else if (s === 'failed') setStatus('failed')
    }

    // Remote audio + video tracks share one MediaStream.
    pc.ontrack = (e) => {
      console.log(`%c[MEDIA] remote ${e.track.kind} track received`, 'color:#6ee7a8;font-weight:bold')
      setRemoteStream(e.streams[0])
    }

    // The non-initiator learns about the data channel here.
    pc.ondatachannel = (e) => setupChannel(e.channel)

    pcRef.current = pc
    return pc
  }, [sendSignal, setupChannel])

  // Grab camera + mic and attach every track BEFORE creating any offer/answer.
  const startLocalMedia = useCallback(async (pc: RTCPeerConnection) => {
    const stream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS)
    stream.getTracks().forEach((track) => {
      console.groupCollapsed(`%c[MEDIA] adding local ${track.kind} track`, 'color:#4f8cff');

      console.log('Constraints:', track.getConstraints());
      console.log('Settings:', track.getSettings());
      console.log('Capabilities:', track.getCapabilities?.());
      console.groupEnd();
      pc.addTrack(track, stream)
    })
    localStreamRef.current = stream
    setLocalStream(stream)
    setMicOn(true)
    setCameraOn(true)
  }, [])

  const flushCandidates = useCallback(async (pc: RTCPeerConnection) => {
    for (const candidate of pendingCandidates.current) {
      try {
        await pc.addIceCandidate(candidate)
      } catch (err) {
        console.warn('[ICE] failed to add queued candidate', err)
      }
    }
    pendingCandidates.current = []
  }, [])

  // Handle a signaling payload relayed from the peer.
  const handleSignal = useCallback(
    async (signal: Signal) => {
      const pc = pcRef.current
      if (!pc) return

      if (signal.kind === 'sdp') {
        console.log(`%c[SDP] remote ${signal.description.type}`, 'color:#a06bff;font-weight:bold')
        await pc.setRemoteDescription(signal.description)
        await flushCandidates(pc)

        // If we received an offer, answer it.
        if (signal.description.type === 'offer') {
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          console.log('%c[SDP] local answer → peer', 'color:#4f8cff;font-weight:bold')
          sendSignal({ kind: 'sdp', description: { type: answer.type, sdp: answer.sdp } })
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
          pendingCandidates.current.push(signal.candidate)
        }
      }
    },
    [flushCandidates, sendSignal],
  )

  const joinRoom = useCallback(
    async (roomId: string) => {
      const code = roomId.trim()
      if (!code) return
      try {
        setError(null)
        setRoom(code)
        setMessages([])
        setStatus('waiting')

        const pc = createPeerConnection()
        // Capture media up front so tracks are present before negotiation.
        await startLocalMedia(pc)

        const ws = new WebSocket(signalingUrl())
        wsRef.current = ws

        ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room: code }))

        ws.onmessage = async (ev) => {
          const msg = JSON.parse(ev.data)
          switch (msg.type) {
            case 'joined':
              console.log(`%c[SIGNAL] joined room '${code}' (${msg.peers} peer(s))`, 'color:#9aa3b2')
              break

            case 'peer-joined': {
              // We were here first → we initiate. Create the data channel + offer.
              console.log('%c[SIGNAL] peer joined — initiating offer', 'color:#4f8cff;font-weight:bold')
              setStatus('connecting')
              const channel = pc.createDataChannel('chat')
              setupChannel(channel)
              const offer = await pc.createOffer()
              await pc.setLocalDescription(offer)
              sendSignal({ kind: 'sdp', description: { type: offer.type, sdp: offer.sdp } })
              break
            }

            case 'signal':
              setStatus('connecting')
              await handleSignal(msg.data as Signal)
              break

            case 'peer-left':
              console.log('%c[SIGNAL] peer left', 'color:#ff8a8a')
              setStatus('disconnected')
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
    [createPeerConnection, startLocalMedia, setupChannel, sendSignal, handleSignal],
  )

  const sendMessage = useCallback(
    (text: string) => {
      const channel = channelRef.current
      if (!channel || channel.readyState !== 'open') return
      channel.send(text)
      addMessage(text, 'me')
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
    setCameraOn(next)
  }, [cameraOn])

  const leaveRoom = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    channelRef.current?.close()
    pcRef.current?.close()
    wsRef.current?.close()
    channelRef.current = null
    pcRef.current = null
    wsRef.current = null
    localStreamRef.current = null
    pendingCandidates.current = []
    setStatus('idle')
    setRoom('')
    setMessages([])
    setError(null)
    setLocalStream(null)
    setRemoteStream(null)
    setMicOn(true)
    setCameraOn(true)
  }, [])

  return {
    status,
    room,
    messages,
    error,
    localStream,
    remoteStream,
    micOn,
    cameraOn,
    joinRoom,
    sendMessage,
    toggleMic,
    toggleCamera,
    leaveRoom,
  }
}
