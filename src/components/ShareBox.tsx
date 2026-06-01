import { useState } from 'react'

export function ShareBox({ url }: { url: string }) {
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
