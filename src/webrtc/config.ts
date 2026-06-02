// Connection + media configuration for the mesh.

export const ICE_SERVERS: RTCIceServer[] = [
  // Public STUN server lets peers discover their public IP so the connection
  // can work across different networks (not just localhost / same LAN).
  { urls: 'stun:stun.l.google.com:19302' },
]

interface ExtendedAudioConstraints extends MediaTrackConstraints {
  latency?: ConstrainDouble
  echoCancellationType?: 'browser' | 'system'
  suppressLocalAudioPlayback?: boolean
}

export const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
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
    voiceIsolation: true,
  } as ExtendedAudioConstraints,
}

// The page is served over HTTPS by Vite, which proxies "/ws" to the Rust
// signaling server. Using the same origin (wss + current host) means the
// browser reuses the TLS cert it already trusts — no extra cert prompt.
export function signalingUrl(): string {
  return "https://rusttourback.onrender.com/ws";
  // const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  // return `${proto}://${location.host}/ws`
}
