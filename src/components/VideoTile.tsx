import { Avatar } from './Avatar'
import { Video } from './Video'

/**
 * A single 16:9 participant tile: video, a camera-off avatar overlay, and the
 * name label. `self` mirrors the video and tags the label with "(you)".
 */
export function VideoTile({
  stream,
  name,
  videoOn,
  self = false,
  sinkId,
}: {
  stream: MediaStream | null
  name: string
  videoOn: boolean
  self?: boolean
  /** Output device for this tile's audio (remote tiles only). */
  sinkId?: string | null
}) {
  return (
    <div className="tile">
      <Video
        stream={stream}
        muted={self}
        sinkId={self ? undefined : sinkId}
        className={self ? 'tile-video tile-video-mirror' : 'tile-video'}
      />
      {!videoOn && <Avatar name={name} />}
      <span className="tile-label">{self ? `${name} (you)` : name}</span>
    </div>
  )
}
