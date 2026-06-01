import { useEffect, useRef, useState } from 'react'
import { useWebRTC, type Status } from './useWebRTC'
import './App.css'

const STATUS_LABEL: Record<Status, string> = {
  idle: 'Not connected',
  waiting: 'Waiting for peer…',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Peer disconnected',
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
    if (!code) return
    location.hash = code
    rtc.joinRoom(code)
  }

  function send(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    rtc.sendMessage(text)
    setDraft('')
  }

  const shareUrl = `${location.origin}/#${rtc.room}`

  return (
    <div className={inCall ? 'app app-incall' : 'app'}>
      {!inCall && (
        <header>
          <h1>WebRTC P2P Call</h1>
          <span className={`status status-${rtc.status}`}>{STATUS_LABEL[rtc.status]}</span>
        </header>
      )}

      {rtc.error && !inCall && <div className="error">⚠ {rtc.error}</div>}

      {/* LOBBY — pick/enter a room code */}
      {rtc.status === 'idle' && (
        <div className="setup">
          <div className="role-pick">
            <p>
              Enter a room code and share it (or the link) with one other person. When you both
              join the same room, the call connects automatically — no copy-paste. Your browser
              will ask for camera + mic permission.
            </p>
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
              <button className="primary" onClick={join}>
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
              {rtc.status === 'connecting' ? 'connecting to peer…' : 'waiting for someone to join.'}
            </p>
            <ShareBox url={shareUrl} />
            {rtc.localStream && (
              <div className="preview">
                <Video stream={rtc.localStream} muted className="preview-video" />
                <span className="preview-label">Your camera</span>
              </div>
            )}
            <button className="link" onClick={rtc.leaveRoom}>
              ← Leave room
            </button>
          </div>
        </div>
      )}

      {/* DISCONNECTED / FAILED */}
      {(rtc.status === 'disconnected' || rtc.status === 'failed') && (
        <div className="setup">
          <button className="primary" onClick={rtc.leaveRoom}>
            Back to lobby
          </button>
        </div>
      )}

      {/* IN CALL — full-viewport video with floating controls + slide-in chat */}
      {inCall && (
        <div className="fscall">
          {/* Remote video fills the whole screen */}
          <Video stream={rtc.remoteStream} className="fs-remote" />
          {!rtc.remoteStream && <p className="hint fs-waiting">Waiting for peer's video…</p>}

          {/* Top gradient bar with title + status */}
          <div className="fs-topbar">
            <span className="fs-title">Room {rtc.room}</span>
            <span className="status status-connected">Connected</span>
          </div>

          {/* Local camera, picture-in-picture (shifts left when chat is open) */}
          <Video
            stream={rtc.localStream}
            muted
            className={chatOpen ? 'fs-local fs-local-shifted' : 'fs-local'}
          />

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
              {rtc.messages.length === 0 && <p className="hint">Chat over the data channel 👋</p>}
              {rtc.messages.map((m) => (
                <div key={m.id} className={`msg msg-${m.from}`}>
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
