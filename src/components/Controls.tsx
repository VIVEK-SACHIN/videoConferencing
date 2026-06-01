/** Floating in-call control bar: mic, camera, chat toggle, hang up. */
export function Controls({
  micOn,
  cameraOn,
  chatOpen,
  unread,
  onToggleMic,
  onToggleCamera,
  onToggleChat,
  onLeave,
}: {
  micOn: boolean
  cameraOn: boolean
  chatOpen: boolean
  unread: number
  onToggleMic: () => void
  onToggleCamera: () => void
  onToggleChat: () => void
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
      <button className="fsbtn hangup" onClick={onLeave}>
        📞 Hang up
      </button>
    </div>
  )
}
