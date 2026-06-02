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
  /** Camera stream; null when the peer has no camera track (e.g. camera off). */
  stream: MediaStream | null
  /** False when the peer's camera is off (show an avatar instead). */
  videoOn: boolean
  /** Screen-share stream when this peer is presenting, else null. */
  screenStream: MediaStream | null
}

/** Devices + initial state chosen on the pre-join screen, handed to the call. */
export type DevicePrefs = {
  micId?: string
  camId?: string
  /** Output device id; only honoured where HTMLMediaElement.setSinkId exists. */
  speakerId?: string
  /** Start the call with the mic on? Defaults to true. */
  micOn?: boolean
  /** Start the call with the camera on? Defaults to true. The track is still
   *  captured (just disabled) so it can be turned on later without renegotiation. */
  camOn?: boolean
}

// Signal payloads we send through the relay (wrapped in {type:'signal',to,data}).
export type SdpSignal = { kind: 'sdp'; description: RTCSessionDescriptionInit }
export type IceSignal = { kind: 'ice'; candidate: RTCIceCandidateInit }
export type Signal = SdpSignal | IceSignal
