/** Floating in-call control bar: mic, camera, chat toggle, hang up. */
export function Controls({
  micOn,
  cameraOn,
  chatOpen,
  settingsOpen,
  sharing,
  shareDisabled,
  unread,
  onToggleMic,
  onToggleCamera,
  onToggleChat,
  onToggleSettings,
  onToggleShare,
  onLeave,
}: {
  micOn: boolean
  cameraOn: boolean
  chatOpen: boolean
  settingsOpen: boolean
  sharing: boolean
  shareDisabled: boolean
  unread: number
  onToggleMic: () => void
  onToggleCamera: () => void
  onToggleChat: () => void
  onToggleSettings: () => void
  onToggleShare: () => void
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
      <button
        className={sharing ? 'fsbtn fsbtn-active' : 'fsbtn'}
        onClick={onToggleShare}
        disabled={shareDisabled}
        title={shareDisabled ? 'Someone else is presenting' : 'Share your screen'}
      >
        {sharing ? '🛑 Stop share' : '🖥️ Share'}
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
