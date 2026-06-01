import { useWebRTC, type Status } from './webrtc'
import { CallView } from './components/CallView'
import { Lobby } from './components/Lobby'
import { WaitingRoom } from './components/WaitingRoom'
import './App.css'

const STATUS_LABEL: Record<Status, string> = {
  idle: 'Not connected',
  waiting: 'Waiting for others…',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  failed: 'Failed',
}

export default function App() {
  const rtc = useWebRTC()
  const inCall = rtc.status === 'connected'
  const inRoom = rtc.status !== 'idle' && rtc.status !== 'failed'

  function handleJoin(room: string, name: string) {
    location.hash = room
    rtc.joinRoom(room, name)
  }

  // In-call is a full-viewport experience with its own chrome.
  if (inCall) return <CallView rtc={rtc} />

  return (
    <div className="app">
      <header>
        <h1>WebRTC Mesh Conference</h1>
        <span className={`status status-${rtc.status}`}>{STATUS_LABEL[rtc.status]}</span>
      </header>

      {rtc.error && <div className="error">⚠ {rtc.error}</div>}

      {rtc.status === 'idle' && <Lobby onJoin={handleJoin} />}

      {inRoom && (
        <WaitingRoom
          room={rtc.room}
          myName={rtc.myName}
          status={rtc.status}
          localStream={rtc.localStream}
          onLeave={rtc.leaveRoom}
        />
      )}

      {rtc.status === 'failed' && (
        <div className="setup">
          <button className="primary" onClick={rtc.leaveRoom}>
            Back to lobby
          </button>
        </div>
      )}
    </div>
  )
}
