/** Floating in-call control bar: mic, camera, chat toggle, hang up. */
export function Controls({
  micOn,
  cameraOn,
  chatOpen,
  settingsOpen,
  unread,
  onToggleMic,
  onToggleCamera,
  onToggleChat,
  onToggleSettings,
  onLeave,
}: {
  micOn: boolean
  cameraOn: boolean
  chatOpen: boolean
  settingsOpen: boolean
  unread: number
  onToggleMic: () => void
  onToggleCamera: () => void
  onToggleChat: () => void
  onToggleSettings: () => void
  onLeave: () => void
}) {
  return (
    <div className="fs-controls">
      <button className={micOn ? 'fsbtn' : 'fsbtn toggled-off'} onClick={onToggleMic}>
        {micOn ? '🎤 Mic on' : '🔇 Mic off'}
      </button>
      <button className={cameraOn ? 'fsbtn' : 'fsbtn toggled-off'} onClick={onToggleCamera}>
        {cameraOn ? '📹 Camera on' : '🚫 Camera off'}
      </button>
      <button className={chatOpen ? 'fsbtn fsbtn-active' : 'fsbtn'} onClick={onToggleChat}>
        💬 Chat
        {unread > 0 && <span className="badge">{unread}</span>}
      </button>
      <button
        className={settingsOpen ? 'fsbtn fsbtn-active' : 'fsbtn'}
        onClick={onToggleSettings}
        title="Devices"
      >
        ⚙️ Devices
      </button>
      <button className="fsbtn hangup" onClick={onLeave}>
        📞 Hang up
      </button>
    </div>
  )
}
