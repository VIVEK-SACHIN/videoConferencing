// Shared types for the WebRTC mesh layer.

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
  /** False when the peer's camera is off (show an avatar instead). */
  videoOn: boolean
}

// Signal payloads we send through the relay (wrapped in {type:'signal',to,data}).
export type SdpSignal = { kind: 'sdp'; description: RTCSessionDescriptionInit }
export type IceSignal = { kind: 'ice'; candidate: RTCIceCandidateInit }
export type Signal = SdpSignal | IceSignal
