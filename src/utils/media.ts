// Audio-output helpers shared by the lobby and the in-call settings.

/** Whether the browser supports routing media output to a chosen device. */
export const SINK_SUPPORTED =
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype

/** Play a short test tone, routed to `speakerId` where setSinkId is supported. */
export async function playTestTone(speakerId?: string | null): Promise<void> {
  try {
    const ctx = new AudioContext()
    const dest = ctx.createMediaStreamDestination()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(dest)
    osc.frequency.value = 440
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4)

    const audio = new Audio()
    audio.srcObject = dest.stream
    if (SINK_SUPPORTED && speakerId) {
      await (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(
        speakerId,
      )
    }
    await audio.play()
    osc.start()
    osc.stop(ctx.currentTime + 0.4)
    osc.onended = () => ctx.close()
  } catch {
    /* best-effort */
  }
}
