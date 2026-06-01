import { useEffect, useState } from 'react'
import type { UseWebRTC } from '../webrtc'
import { ChatPanel } from './ChatPanel'
import { Controls } from './Controls'
import { VideoGrid } from './VideoGrid'

/** The in-call experience: participant grid, top bar, controls, and chat. */
export function CallView({ rtc }: { rtc: UseWebRTC }) {
  const [chatOpen, setChatOpen] = useState(false)
  const [seenCount, setSeenCount] = useState(0)

  // Unread badge: count messages that arrived while the chat drawer was closed.
  useEffect(() => {
    if (chatOpen) setSeenCount(rtc.messages.length)
  }, [chatOpen, rtc.messages.length])
  const unread = Math.max(0, rtc.messages.length - seenCount)

  return (
    <div className="fscall">
      <VideoGrid
        localStream={rtc.localStream}
        myName={rtc.myName}
        cameraOn={rtc.cameraOn}
        remotePeers={rtc.remotePeers}
        chatOpen={chatOpen}
      />

      <div className="fs-topbar">
        <span className="fs-title">Room {rtc.room}</span>
        <span className="status status-connected">{rtc.remotePeers.length + 1} in call</span>
      </div>

      <Controls
        micOn={rtc.micOn}
        cameraOn={rtc.cameraOn}
        chatOpen={chatOpen}
        unread={unread}
        onToggleMic={rtc.toggleMic}
        onToggleCamera={rtc.toggleCamera}
        onToggleChat={() => setChatOpen((o) => !o)}
        onLeave={rtc.leaveRoom}
      />

      <ChatPanel
        open={chatOpen}
        messages={rtc.messages}
        onClose={() => setChatOpen(false)}
        onSend={rtc.sendMessage}
      />
    </div>
  )
}
