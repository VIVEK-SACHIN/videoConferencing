import { useEffect, useRef, useState } from 'react'
import { useWebRTC, type Status } from './useWebRTC'
import './App.css'

const STATUS_LABEL: Record<Status, string> = {
  idle: 'Not connected',
  waiting: 'Waiting for others…',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  failed: 'Failed',
}

/** Binds a MediaStream to a <video> element via srcObject (can't be set in JSX). */
function Video({
  stream,
  muted,
  className,
}: {
  stream: MediaStream | null
  muted?: boolean
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream
    }
  }, [stream])
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />
}

// Initials for the camera-off avatar: first letters of the first two words,
// or the first two letters of a single-word name.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

// Deterministic hue from a name so each person gets a stable avatar colour.
function avatarHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

/** Shown over a tile when that participant's camera is off. */
function Avatar({ name }: { name: string }) {
  return (
    <div className="tile-avatar">
      <div className="avatar-circle" style={{ background: `hsl(${avatarHue(name)} 55% 45%)` }}>
        {initials(name)}
      </div>
    </div>
  )
}

// A short, easy-to-share room code. Avoids ambiguous characters.
function randomRoom(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export default function App() {
  const rtc = useWebRTC()
  // Prefill the room from the URL hash so sharing a link "just works".
  const [roomInput, setRoomInput] = useState(() => location.hash.slice(1) || randomRoom())
  const [nameInput, setNameInput] = useState('')
  const [draft, setDraft] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [seenCount, setSeenCount] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const inCall = rtc.status === 'connected'
  const inRoom = rtc.status !== 'idle' && rtc.status !== 'failed'

  // Unread badge: count messages that arrived while the chat drawer was closed.
  useEffect(() => {
    if (chatOpen) setSeenCount(rtc.messages.length)
  }, [chatOpen, rtc.messages.length])
  const unread = Math.max(0, rtc.messages.length - seenCount)

  useEffect(() => {
    if (chatOpen) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [rtc.messages, chatOpen])

  function join() {
    const code = roomInput.trim()
    const name = nameInput.trim()
    if (!code || !name) return
    location.hash = code
    rtc.joinRoom(code, name)
  }

  function send(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    rtc.sendMessage(text)
    setDraft('')
  }

  const shareUrl = `${location.origin}/#${rtc.room}`
  const canJoin = roomInput.trim() !== '' && nameInput.trim() !== ''

  return (
    <div className={inCall ? 'app app-incall' : 'app'}>
      {!inCall && (
        <header>
          <h1>WebRTC Mesh Conference</h1>
          <span className={`status status-${rtc.status}`}>{STATUS_LABEL[rtc.status]}</span>
        </header>
      )}

      {rtc.error && !inCall && <div className="error">⚠ {rtc.error}</div>}

      {/* LOBBY — pick a name + room code */}
      {rtc.status === 'idle' && (
        <div className="setup">
          <div className="role-pick">
            <p>
              Enter your name and a room code, then share the code (or link) with up to 3 other
              people. Everyone who joins the same room connects in a peer-to-peer mesh — no copy-paste.
              Your browser will ask for camera + mic permission.
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
      )}

      {/* WAITING / CONNECTING — show local preview + shareable code */}
      {inRoom && !inCall && (
        <div className="setup">
          <div className="waiting">
            <p>
              Room <code className="roomcode">{rtc.room}</code> —{' '}
              {rtc.status === 'connecting' ? 'connecting to peers…' : 'waiting for others to join.'}
            </p>
            <ShareBox url={shareUrl} />
            {rtc.localStream && (
              <div className="preview">
                <Video stream={rtc.localStream} muted className="preview-video" />
                <span className="preview-label">{rtc.myName} (you)</span>
              </div>
            )}
            <button className="link" onClick={rtc.leaveRoom}>
              ← Leave room
            </button>
          </div>
        </div>
      )}

      {/* FAILED */}
      {rtc.status === 'failed' && (
        <div className="setup">
          <button className="primary" onClick={rtc.leaveRoom}>
            Back to lobby
          </button>
        </div>
      )}

      {/* IN CALL — grid of remote participants + floating controls + slide-in chat */}
      {inCall && (
        <div className="fscall">
          {/* All participants (self first) in one space-filling 16:9 grid */}
          <div
            className={chatOpen ? 'fs-grid chat-open' : 'fs-grid'}
            data-count={rtc.remotePeers.length + 1}
          >
            {/* Self tile, always first */}
            <div className="tile">
              <Video stream={rtc.localStream} muted className="tile-video tile-video-mirror" />
              {!rtc.cameraOn && <Avatar name={rtc.myName} />}
              <span className="tile-label">{rtc.myName} (you)</span>
            </div>
            {rtc.remotePeers.map((peer) => (
              <div className="tile" key={peer.id}>
                <Video stream={peer.stream} className="tile-video" />
                {!peer.videoOn && <Avatar name={peer.name} />}
                <span className="tile-label">{peer.name}</span>
              </div>
            ))}
          </div>

          {/* Top gradient bar with title + status */}
          <div className="fs-topbar">
            <span className="fs-title">Room {rtc.room}</span>
            <span className="status status-connected">
              {rtc.remotePeers.length + 1} in call
            </span>
          </div>

          {/* Floating control bar */}
          <div className="fs-controls">
            <button className={rtc.micOn ? 'fsbtn' : 'fsbtn toggled-off'} onClick={rtc.toggleMic}>
              {rtc.micOn ? '🎤 Mic on' : '🔇 Mic off'}
            </button>
            <button
              className={rtc.cameraOn ? 'fsbtn' : 'fsbtn toggled-off'}
              onClick={rtc.toggleCamera}
            >
              {rtc.cameraOn ? '📹 Camera on' : '🚫 Camera off'}
            </button>
            <button
              className={chatOpen ? 'fsbtn fsbtn-active' : 'fsbtn'}
              onClick={() => setChatOpen((o) => !o)}
            >
              💬 Chat
              {unread > 0 && <span className="badge">{unread}</span>}
            </button>
            <button className="fsbtn hangup" onClick={rtc.leaveRoom}>
              📞 Hang up
            </button>
          </div>

          {/* Slide-in chat sidebar */}
          <aside className={chatOpen ? 'fs-chat open' : 'fs-chat'}>
            <div className="fs-chat-head">
              <span>Chat</span>
              <button className="fs-chat-close" onClick={() => setChatOpen(false)} title="Close">
                ✕
              </button>
            </div>
            <div className="messages">
              {rtc.messages.length === 0 && <p className="hint">Chat with the whole room 👋</p>}
              {rtc.messages.map((m) => (
                <div key={m.id} className={`msg msg-${m.from}`}>
                  {m.from === 'peer' && m.name && <span className="msg-name">{m.name}</span>}
                  <span className="bubble">{m.text}</span>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <form className="composer" onSubmit={send}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a message…"
              />
              <button className="primary" type="submit" disabled={!draft.trim()}>
                Send
              </button>
            </form>
          </aside>
        </div>
      )}
    </div>
  )
}

function ShareBox({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="copybox">
      <div className="copybox-head">
        <span>Share this link</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <textarea readOnly value={url} rows={2} />
    </div>
  )
}
