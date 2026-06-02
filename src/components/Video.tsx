import { useEffect, useRef } from 'react'

/** Binds a MediaStream to a <video> element via srcObject (can't be set in JSX). */
export function Video({
  stream,
  muted,
  className,
  sinkId,
}: {
  stream: MediaStream | null
  muted?: boolean
  className?: string
  /** Output device id; routed via setSinkId where supported. */
  sinkId?: string | null
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream
    }
  }, [stream])
  useEffect(() => {
    const el = ref.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (el && sinkId && typeof el.setSinkId === 'function') {
      el.setSinkId(sinkId).catch((err) => console.warn('[AUDIO] setSinkId failed', err))
    }
  }, [sinkId, stream])
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />
}
