import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../webrtc'

/** Slide-in chat sidebar. Owns its own draft input; messages come from props. */
export function ChatPanel({
  open,
  messages,
  onClose,
  onSend,
}: {
  open: boolean
  messages: ChatMessage[]
  onClose: () => void
  onSend: (text: string) => void
}) {
  const [draft, setDraft] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    onSend(text)
    setDraft('')
  }

  return (
    <aside className={open ? 'fs-chat open' : 'fs-chat'}>
      <div className="fs-chat-head">
        <span>Chat</span>
        <button className="fs-chat-close" onClick={onClose} title="Close">
          ✕
        </button>
      </div>
      <div className="messages">
        {messages.length === 0 && <p className="hint">Chat with the whole room 👋</p>}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.from}`}>
            {m.from === 'peer' && m.name && <span className="msg-name">{m.name}</span>}
            <span className="bubble">{m.text}</span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form className="composer" onSubmit={submit}>
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
  )
}
