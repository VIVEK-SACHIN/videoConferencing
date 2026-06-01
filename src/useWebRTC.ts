import { useCallback, useRef, useState } from 'react'

/**
 * A WebRTC peer-to-peer chat hook using *manual* (copy-paste) signaling.
 *
 * WebRTC needs a "signaling channel" to exchange two things before a direct
 * connection can form:
 *   1. Session descriptions (SDP) — the offer/answer describing media + transport.
 *   2. ICE candidates — the network routes (IP:port pairs) each peer can be reached on.
 *
 * Normally a server relays these. Here we skip the server entirely: we wait for
 * ICE gathering to finish so every candidate is baked into the SDP, then encode
 * the whole description as one base64 blob you copy/paste between the two peers.
 *
 * Flow:
 *   Peer A (caller):  createOffer()  -> copy blob -> send to B
 *   Peer B (callee):  acceptOffer(blobFromA) -> copy answer blob -> send back to A
 *   Peer A (caller):  acceptAnswer(blobFromB)
 *   ...data channel opens, chat flows directly between browsers.
 */

export type ChatMessage = {
  id: string
  text: string
  from: 'me' | 'peer'
  at: number
}

export type Role = 'none' | 'caller' | 'callee'

export type Status =
  | 'idle'
  | 'creating-offer'
  | 'awaiting-answer'
  | 'creating-answer'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'

const ICE_SERVERS: RTCIceServer[] = [
  // Public STUN server lets peers discover their public IP so the connection
  // can work across different networks (not just localhost / same LAN).
  { urls: 'stun:stun.l.google.com:19302' },
]

// Encode/decode an SDP description as a compact, copy-paste-friendly string.
function encodeSignal(desc: RTCSessionDescription): string {
  // Log the full session description so you can read the raw SDP in the console.
  console.groupCollapsed(`%c[SDP] local ${desc.type}`, 'color:#4f8cff;font-weight:bold')
  console.log(desc.sdp)
  console.groupEnd()
  return btoa(JSON.stringify({ type: desc.type, sdp: desc.sdp }))
}

function decodeSignal(blob: string): RTCSessionDescriptionInit {
  const parsed = JSON.parse(atob(blob.trim()))
  console.groupCollapsed(`%c[SDP] remote ${parsed.type}`, 'color:#a06bff;font-weight:bold')
  console.log(parsed.sdp)
  console.groupEnd()
  if (!parsed.type || !parsed.sdp) throw new Error('Not a valid signal blob')
  return parsed as RTCSessionDescriptionInit
}

// Resolve once ICE gathering finishes, so the local description contains all
// candidates inline (non-trickle ICE). This is what makes single-blob copy-paste work.
//
// Along the way we log every ICE candidate as the browser discovers it, plus
// the gathering-state transitions, so you can watch the process live.
function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  console.log(
    `%c[ICE] gathering started (state: ${pc.iceGatheringState})`,
    'color:#ffd27a;font-weight:bold',
  )

  let count = 0
  const onCandidate = (e: RTCPeerConnectionIceEvent) => {
    if (e.candidate) {
      count++
      // The .candidate string is the raw SDP line; the parsed fields tell you
      // the candidate type (host / srflx = STUN-reflexive / relay = TURN).
      const c = e.candidate
      console.log(
        `%c[ICE] candidate #${count}`,
        'color:#6ee7a8',
        `${c.type ?? '?'} ${c.protocol ?? ''} ${c.address ?? ''}:${c.port ?? ''}`,
        '\n  ' + c.candidate,
      )
    } else {
      // A null candidate signals the end of gathering.
      console.log('%c[ICE] end-of-candidates (null)', 'color:#9aa3b2')
    }
  }
  pc.addEventListener('icecandidate', onCandidate)

  if (pc.iceGatheringState === 'complete') {
    pc.removeEventListener('icecandidate', onCandidate)
    console.log('%c[ICE] already complete', 'color:#ffd27a;font-weight:bold')
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    function finish(reason: string) {
      pc.removeEventListener('icegatheringstatechange', check)
      pc.removeEventListener('icecandidate', onCandidate)
      console.log(
        `%c[ICE] gathering done (${reason}) — ${count} candidate(s)`,
        'color:#ffd27a;font-weight:bold',
      )
      resolve()
    }
    function check() {
      console.log(`%c[ICE] gathering state: ${pc.iceGatheringState}`, 'color:#9aa3b2')
      if (pc.iceGatheringState === 'complete') finish('complete')
    }
    pc.addEventListener('icegatheringstatechange', check)
    // Safety net: some browsers can stall; give up gathering after 3s and
    // proceed with whatever candidates we have.
    setTimeout(() => {
      if (pc.iceGatheringState !== 'complete') finish('timeout 3s')
    }, 3000)
  })
}

let messageCounter = 0
function newMessageId(): string {
  return `${Date.now()}-${messageCounter++}`
}

export function useWebRTC() {
  const [role, setRole] = useState<Role>('none')
  const [status, setStatus] = useState<Status>('idle')
  const [localSignal, setLocalSignal] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const channelRef = useRef<RTCDataChannel | null>(null)

  const addMessage = useCallback((text: string, from: 'me' | 'peer') => {
    setMessages((prev) => [...prev, { id: newMessageId(), text, from, at: Date.now() }])
  }, [])

  // Wire up a data channel (created by us, or received via ondatachannel).
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

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      console.log(`%c[PC] connection state: ${s}`, 'color:#4f8cff;font-weight:bold')
      if (s === 'connecting') setStatus('connecting')
      else if (s === 'connected') setStatus('connected')
      else if (s === 'disconnected' || s === 'closed') setStatus('disconnected')
      else if (s === 'failed') setStatus('failed')
    }

    // The callee learns about the channel here (the caller created it).
    pc.ondatachannel = (e) => setupChannel(e.channel)

    pcRef.current = pc
    return pc
  }, [setupChannel])

  // --- Caller: step 1 ---
  const createOffer = useCallback(async () => {
    try {
      setError(null)
      setRole('caller')
      setStatus('creating-offer')
      const pc = createPeerConnection()

      // Caller proactively creates the data channel.
      const channel = pc.createDataChannel('chat')
      setupChannel(channel)

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await waitForIceGathering(pc)

      setLocalSignal(encodeSignal(pc.localDescription!))
      setStatus('awaiting-answer')
    } catch (err) {
      setError((err as Error).message)
      setStatus('failed')
    }
  }, [createPeerConnection, setupChannel])

  // --- Callee: switch into the "join" view before pasting the offer ---
  const joinAsCallee = useCallback(() => {
    setError(null)
    setRole('callee')
    setStatus('idle')
  }, [])

  // --- Callee: step 1 (takes the caller's offer blob) ---
  const acceptOffer = useCallback(
    async (offerBlob: string) => {
      try {
        setError(null)
        setRole('callee')
        setStatus('creating-answer')
        const pc = createPeerConnection()

        await pc.setRemoteDescription(decodeSignal(offerBlob))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await waitForIceGathering(pc)

        setLocalSignal(encodeSignal(pc.localDescription!))
      } catch (err) {
        setError((err as Error).message)
        setStatus('failed')
      }
    },
    [createPeerConnection],
  )

  // --- Caller: step 2 (takes the callee's answer blob) ---
  const acceptAnswer = useCallback(async (answerBlob: string) => {
    try {
      setError(null)
      const pc = pcRef.current
      if (!pc) throw new Error('No active connection — create an offer first')
      setStatus('connecting')
      await pc.setRemoteDescription(decodeSignal(answerBlob))
    } catch (err) {
      setError((err as Error).message)
      setStatus('failed')
    }
  }, [])

  const sendMessage = useCallback(
    (text: string) => {
      const channel = channelRef.current
      if (!channel || channel.readyState !== 'open') return
      channel.send(text)
      addMessage(text, 'me')
    },
    [addMessage],
  )

  const reset = useCallback(() => {
    channelRef.current?.close()
    pcRef.current?.close()
    channelRef.current = null
    pcRef.current = null
    setRole('none')
    setStatus('idle')
    setLocalSignal('')
    setMessages([])
    setError(null)
  }, [])

  return {
    role,
    status,
    localSignal,
    messages,
    error,
    createOffer,
    joinAsCallee,
    acceptOffer,
    acceptAnswer,
    sendMessage,
    reset,
  }
}
