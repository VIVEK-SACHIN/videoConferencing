import type { Status } from '../webrtc'
import { ShareBox } from './ShareBox'
import { Video } from './Video'

/** Shown after joining while alone or negotiating: local preview + share link. */
export function WaitingRoom({
  room,
  myName,
  status,
  localStream,
  onLeave,
}: {
  room: string
  myName: string
  status: Status
  localStream: MediaStream | null
  onLeave: () => void
}) {
  const shareUrl = `${location.origin}/#${room}`
  return (
    <div className="setup">
      <div className="waiting">
        <p>
          Room <code className="roomcode">{room}</code> —{' '}
          {status === 'connecting' ? 'connecting to peers…' : 'waiting for others to join.'}
        </p>
        <ShareBox url={shareUrl} />
        {localStream && (
          <div className="preview">
            <Video stream={localStream} muted className="preview-video" />
            <span className="preview-label">{myName} (you)</span>
          </div>
        )}
        <button className="link" onClick={onLeave}>
          ← Leave room
        </button>
      </div>
    </div>
  )
}
