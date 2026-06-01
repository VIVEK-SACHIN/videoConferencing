import { useEffect, useRef } from 'react'

/** Binds a MediaStream to a <video> element via srcObject (can't be set in JSX). */
export function Video({
  stream,
  muted,
  className,
}: {
  stream: MediaStream | null
  muted?: boolean
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream
    }
  }, [stream])
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />
}
