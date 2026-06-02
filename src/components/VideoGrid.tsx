import type { RemotePeer } from '../webrtc'
import { VideoTile } from './VideoTile'

/**
 * Space-filling grid of all participants, self first. `data-count` (total
 * participants) drives the column layout in CSS.
 */
export function VideoGrid({
  localStream,
  myName,
  cameraOn,
  remotePeers,
  chatOpen,
  speakerId,
}: {
  localStream: MediaStream | null
  myName: string
  cameraOn: boolean
  remotePeers: RemotePeer[]
  chatOpen: boolean
  speakerId: string | null
}) {
  return (
    <div className={chatOpen ? 'fs-grid chat-open' : 'fs-grid'} data-count={remotePeers.length + 1}>
      <VideoTile stream={localStream} name={myName} videoOn={cameraOn} self />
      {remotePeers.map((peer) => (
        <VideoTile
          key={peer.id}
          stream={peer.stream}
          name={peer.name}
          videoOn={peer.videoOn}
          sinkId={speakerId}
        />
      ))}
    </div>
  )
}
