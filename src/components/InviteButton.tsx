import { useState } from 'react'

/** Copies the room's share link to the clipboard, with brief confirmation. */
export function InviteButton({ room }: { room: string }) {
  const [copied, setCopied] = useState(false)
  const url = `${location.origin}/#${room}`
  return (
    <button
      className="invite-btn"
      title="Copy invite link"
      onClick={() => {
        navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? '✓ Link copied' : '🔗 Invite'}
    </button>
  )
}
