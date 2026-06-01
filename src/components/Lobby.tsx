import { useState } from 'react'
import { randomRoom } from '../utils/names'

/** Lobby: collect a display name + room code, then join. */
export function Lobby({ onJoin }: { onJoin: (room: string, name: string) => void }) {
  // Prefill the room from the URL hash so sharing a link "just works".
  const [roomInput, setRoomInput] = useState(() => location.hash.slice(1) || randomRoom())
  const [nameInput, setNameInput] = useState('')

  const canJoin = roomInput.trim() !== '' && nameInput.trim() !== ''

  function join() {
    if (!canJoin) return
    onJoin(roomInput.trim(), nameInput.trim())
  }

  return (
    <div className="setup">
      <div className="role-pick">
        <p>
          Enter your name and a room code, then share the code (or link) with up to 3 other people.
          Everyone who joins the same room connects in a peer-to-peer mesh — no copy-paste. Your
          browser will ask for camera + mic permission.
        </p>
        <div className="join-row">
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && join()}
            placeholder="your name"
            spellCheck={false}
            autoFocus
          />
        </div>
        <div className="join-row">
          <input
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && join()}
            placeholder="room code"
            spellCheck={false}
          />
          <button onClick={() => setRoomInput(randomRoom())} title="New random code">
            🎲
          </button>
          <button className="primary" onClick={join} disabled={!canJoin}>
            Join room
          </button>
        </div>
      </div>
    </div>
  )
}
