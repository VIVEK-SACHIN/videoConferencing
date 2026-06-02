import { useEffect, useState } from 'react'
import type { UseWebRTC } from '../webrtc'
import { ChatPanel } from './ChatPanel'
import { Controls } from './Controls'
import { DeviceSettings } from './DeviceSettings'
import { InviteButton } from './InviteButton'
import { PresentationLayout } from './PresentationLayout'
import { VideoGrid } from './VideoGrid'

/** The in-call experience: participant grid, top bar, controls, and chat. */
export function CallView({ rtc }: { rtc: UseWebRTC }) {
  const [chatOpen, setChatOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [seenCount, setSeenCount] = useState(0)

  // Unread badge: count messages that arrived while the chat drawer was closed.
  useEffect(() => {
    if (chatOpen) setSeenCount(rtc.messages.length)
  }, [chatOpen, rtc.messages.length])
  const unread = Math.max(0, rtc.messages.length - seenCount)

  const presenting = rtc.presenterId != null

  return (
    <div className="fscall">
      {presenting ? (
        <PresentationLayout rtc={rtc} chatOpen={chatOpen} />
      ) : (
        <VideoGrid
          localStream={rtc.localStream}
          myName={rtc.myName}
          cameraOn={rtc.cameraOn}
          remotePeers={rtc.remotePeers}
          chatOpen={chatOpen}
          speakerId={rtc.speakerId}
        />
      )}

      <div className="fs-topbar">
        <span className="fs-title">Room {rtc.room}</span>
        <div className="fs-topbar-right">
          <span className="status status-connected">
            {rtc.remotePeers.length === 0
              ? 'Waiting for others…'
              : `${rtc.remotePeers.length + 1} in call`}
          </span>
          <InviteButton room={rtc.room} />
        </div>
      </div>

      {settingsOpen && (
        <DeviceSettings
          micId={rtc.micId}
          camId={rtc.camId}
          speakerId={rtc.speakerId}
          onSelectMic={rtc.switchMicrophone}
          onSelectCamera={rtc.switchCamera}
          onSelectSpeaker={rtc.setSpeaker}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <Controls
        micOn={rtc.micOn}
        cameraOn={rtc.cameraOn}
        chatOpen={chatOpen}
        settingsOpen={settingsOpen}
        sharing={rtc.presenterId === rtc.myId}
        shareDisabled={presenting && rtc.presenterId !== rtc.myId}
        unread={unread}
        onToggleMic={rtc.toggleMic}
        onToggleCamera={rtc.toggleCamera}
        onToggleChat={() => setChatOpen((o) => !o)}
        onToggleSettings={() => setSettingsOpen((o) => !o)}
        onToggleShare={() => (rtc.presenterId === rtc.myId ? rtc.stopScreenShare() : rtc.startScreenShare())}
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
