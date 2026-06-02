import { useEffect, useRef, useState } from 'react'
import { useCapturedSurfaceControl } from '../hooks/useCapturedSurfaceControl'
import type { UseWebRTC } from '../webrtc'
import { VideoTile } from './VideoTile'

/** The big shared-screen view, with presenter-side zoom controls (CSC). */
function ScreenView({
  stream,
  isOwn,
  controller,
}: {
  stream: MediaStream | null
  isOwn: boolean
  controller: CaptureController | null
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [el, setEl] = useState<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream
  }, [stream])
  useEffect(() => setEl(ref.current), [])

  // Captured Surface Control only applies to our own tab capture.
  const csc = useCapturedSurfaceControl(isOwn ? controller : null, el)

  return (
    <div className="present-stage">
      <video ref={ref} className="present-video" autoPlay playsInline muted />
      {isOwn && csc.supportsZoom && (
        <div className="csc-controls">
          <button onClick={csc.zoomOut} title="Zoom out">
            －
          </button>
          <span>{csc.zoomLevel ?? 100}%</span>
          <button onClick={csc.zoomIn} title="Zoom in">
            ＋
          </button>
          <button onClick={csc.resetZoom} title="Reset zoom">
            Reset
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Presentation layout: the shared screen fills the left (16:9), participant
 * cameras stack in a 16:9 sidebar on the right. Shown whenever someone presents.
 */
export function PresentationLayout({ rtc, chatOpen }: { rtc: UseWebRTC; chatOpen: boolean }) {
  const presenter = rtc.remotePeers.find((p) => p.id === rtc.presenterId)
  const isOwn = rtc.presenterId === rtc.myId
  const screenStream = isOwn ? rtc.localScreenStream : (presenter?.screenStream ?? null)
  const presenterName = isOwn ? `${rtc.myName} (you)` : (presenter?.name ?? 'Someone')

  return (
    <div className={chatOpen ? 'present chat-open' : 'present'}>
      <div className="present-main">
        <ScreenView stream={screenStream} isOwn={isOwn} controller={rtc.screenController} />
        <span className="present-name">🖥️ {presenterName} is presenting</span>
      </div>

      <div className="present-sidebar">
        <VideoTile stream={rtc.localStream} name={rtc.myName} videoOn={rtc.cameraOn} self />
        {rtc.remotePeers.map((peer) => (
          <VideoTile
            key={peer.id}
            stream={peer.stream}
            name={peer.name}
            videoOn={peer.videoOn}
            sinkId={rtc.speakerId}
          />
        ))}
      </div>
    </div>
  )
}
