import { useEffect, useRef, useState } from 'react'
import { useWebRTC, type Status } from './useWebRTC'
import './App.css'

const STATUS_LABEL: Record<Status, string> = {
  idle: 'Not connected',
  'creating-offer': 'Creating offer…',
  'awaiting-answer': 'Waiting for answer',
  'creating-answer': 'Creating answer…',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  failed: 'Failed',
}

function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  return (
    <div className="copybox">
      <div className="copybox-head">
        <span>{label}</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <textarea readOnly value={value} rows={4} />
    </div>
  )
}

export default function App() {
  const rtc = useWebRTC()
  const [answerInput, setAnswerInput] = useState('')
  const [offerInput, setOfferInput] = useState('')
  const [draft, setDraft] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const connected = rtc.status === 'connected'

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [rtc.messages])

  function send(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    rtc.sendMessage(text)
    setDraft('')
  }

  return (
    <div className="app">
      <header>
        <h1>WebRTC P2P Chat</h1>
        <span className={`status status-${rtc.status}`}>{STATUS_LABEL[rtc.status]}</span>
      </header>

      {rtc.error && <div className="error">⚠ {rtc.error}</div>}

      {!connected && (
        <div className="setup">
          {rtc.role === 'none' && (
            <div className="role-pick">
              <p>
                Two browsers connect directly. One side <strong>starts</strong> the call,
                the other <strong>joins</strong>. Copy the blobs between them.
              </p>
              <div className="role-buttons">
                <button className="primary" onClick={rtc.createOffer}>
                  Start a call (Peer A)
                </button>
                <button onClick={rtc.joinAsCallee}>Join a call (Peer B)</button>
              </div>
            </div>
          )}

          {/* CALLER FLOW */}
          {rtc.role === 'caller' && (
            <ol className="steps">
              <li>
                <strong>Send this offer to Peer B.</strong>
                <CopyBox label="Your offer" value={rtc.localSignal} />
              </li>
              <li>
                <strong>Paste the answer you get back from Peer B:</strong>
                <textarea
                  rows={4}
                  placeholder="Paste Peer B's answer blob here…"
                  value={answerInput}
                  onChange={(e) => setAnswerInput(e.target.value)}
                />
                <button
                  className="primary"
                  disabled={!answerInput.trim()}
                  onClick={() => rtc.acceptAnswer(answerInput)}
                >
                  Connect
                </button>
              </li>
            </ol>
          )}

          {/* CALLEE FLOW */}
          {rtc.role === 'callee' && (
            <ol className="steps">
              <li>
                <strong>Paste the offer from Peer A:</strong>
                <textarea
                  rows={4}
                  placeholder="Paste Peer A's offer blob here…"
                  value={offerInput}
                  onChange={(e) => setOfferInput(e.target.value)}
                />
                <button
                  className="primary"
                  disabled={!offerInput.trim() || !!rtc.localSignal}
                  onClick={() => rtc.acceptOffer(offerInput)}
                >
                  Generate answer
                </button>
              </li>
              <li>
                <strong>Send this answer back to Peer A.</strong> Connection opens automatically.
                <CopyBox label="Your answer" value={rtc.localSignal} />
              </li>
            </ol>
          )}

          {rtc.role !== 'none' && (
            <button className="link" onClick={rtc.reset}>
              ← Start over
            </button>
          )}
        </div>
      )}

      {connected && (
        <div className="chat">
          <div className="messages">
            {rtc.messages.length === 0 && (
              <p className="hint">Connected! Say hi 👋</p>
            )}
            {rtc.messages.map((m) => (
              <div key={m.id} className={`msg msg-${m.from}`}>
                <span className="bubble">{m.text}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form className="composer" onSubmit={send}>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a message…"
            />
            <button className="primary" type="submit" disabled={!draft.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
