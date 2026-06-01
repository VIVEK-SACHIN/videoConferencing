// Prefer H.264 for video. Machines commonly have *hardware* encoders only for
// H.264 (and HEVC); the WebRTC default VP8 falls back to a software encoder,
// which pegs the CPU and heats the laptop — especially in a mesh where each tab
// encodes its camera once per peer. Reordering codecs so H.264 is first makes
// both ends negotiate it, engaging the GPU encoder/decoder.
export function preferH264(transceiver: RTCRtpTransceiver): void {
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
