import { useWebRTC, type DevicePrefs } from './webrtc'
import { CallView } from './components/CallView'
import { Lobby } from './components/Lobby'
import './App.css'

export default function App() {
  const rtc = useWebRTC()
  // Once you're in a room you're in the meeting — even alone, with just your
  // own tile filling the grid. Otherwise you're on the full-screen pre-join
  // screen (a failed join drops back here with an error banner).
  const inRoom = rtc.status !== 'idle' && rtc.status !== 'failed'

  function handleJoin(room: string, name: string, devices: DevicePrefs) {
    location.hash = room
    rtc.joinRoom(room, name, devices)
  }

  if (inRoom) return <CallView rtc={rtc} />
  return <Lobby onJoin={handleJoin} error={rtc.error} />
}
