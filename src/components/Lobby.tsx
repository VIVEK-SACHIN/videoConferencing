import { useEffect, useRef, useState } from 'react'
import { randomRoom } from '../utils/names'
import { SINK_SUPPORTED, playTestTone } from '../utils/media'
import type { DevicePrefs } from '../webrtc'
import { Avatar } from './Avatar'
import { Video } from './Video'

type Device = { deviceId: string; label: string }

/** Small on/off pill switch (presentational). */
function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      className={on ? 'switch on' : 'switch'}
      onClick={onToggle}
      role="switch"
      aria-checked={on}
    >
      <span className="switch-knob" />
    </button>
  )
}

/**
 * Pre-join screen: a live local camera preview with working device controls
 * (mic/camera switch the preview, speaker is routed via setSinkId), plus the
 * Name + Room ID form that starts the call. The chosen devices are handed to
 * the call on join.
 */
export function Lobby({
  onJoin,
  error,
}: {
  onJoin: (room: string, name: string, devices: DevicePrefs) => void
  error?: string | null
}) {
  // Prefill the room from the URL hash so sharing a link "just works".
  const [roomInput, setRoomInput] = useState(() => location.hash.slice(1) || randomRoom())
  const [nameInput, setNameInput] = useState('')

  const [stream, setStream] = useState<MediaStream | null>(null)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [mirrored, setMirrored] = useState(true)

  const [mics, setMics] = useState<Device[]>([])
  const [cams, setCams] = useState<Device[]>([])
  const [speakers, setSpeakers] = useState<Device[]>([])
  const [selectedMic, setSelectedMic] = useState('')
  const [selectedCam, setSelectedCam] = useState('')
  const [selectedSpeaker, setSelectedSpeaker] = useState('')

  const streamRef = useRef<MediaStream | null>(null)
  const micOnRef = useRef(true)
  const camOnRef = useRef(true)
  const canJoin = roomInput.trim() !== '' && nameInput.trim() !== ''

  async function refreshDeviceList() {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const pick = (kind: MediaDeviceKind, name: string): Device[] =>
      devices
        .filter((d) => d.kind === kind)
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${name} ${i + 1}` }))
    setMics(pick('audioinput', 'Microphone'))
    setCams(pick('videoinput', 'Camera'))
    setSpeakers(pick('audiooutput', 'Speaker'))
    return devices
  }

  // Acquire a local preview + populate device lists once.
  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        })
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = s
        setStream(s)

        // Reflect the devices we actually got, then list the rest (labels are
        // only available after permission is granted).
        setSelectedCam(s.getVideoTracks()[0]?.getSettings().deviceId ?? '')
        setSelectedMic(s.getAudioTracks()[0]?.getSettings().deviceId ?? '')
        const devices = await refreshDeviceList()
        if (cancelled) return
        const firstSpeaker = devices.find((d) => d.kind === 'audiooutput')
        if (firstSpeaker) setSelectedSpeaker(firstSpeaker.deviceId)
      } catch {
        /* preview unavailable — the form still works */
      }
    }
    init()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  // Swap a single track (audio or video) in the live preview stream without
  // disturbing the other one.
  async function switchDevice(kind: 'audio' | 'video', deviceId: string) {
    if (kind === 'video') setSelectedCam(deviceId)
    else setSelectedMic(deviceId)
    try {
      const constraints: MediaStreamConstraints =
        kind === 'video'
          ? { video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } }
          : { audio: { deviceId: { exact: deviceId } } }
      const tmp = await navigator.mediaDevices.getUserMedia(constraints)
      const next = kind === 'video' ? tmp.getVideoTracks()[0] : tmp.getAudioTracks()[0]
      const s = streamRef.current
      if (!s) {
        streamRef.current = tmp
        setStream(tmp)
        return
      }
      const old = kind === 'video' ? s.getVideoTracks()[0] : s.getAudioTracks()[0]
      if (old) {
        s.removeTrack(old)
        old.stop()
      }
      next.enabled = kind === 'video' ? camOnRef.current : micOnRef.current
      s.addTrack(next)
    } catch (err) {
      console.warn('[DEVICE] could not switch', kind, err)
    }
  }

  function toggleMic() {
    const next = !micOn
    micOnRef.current = next
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next))
    setMicOn(next)
  }
  function toggleCam() {
    const next = !camOn
    camOnRef.current = next
    streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next))
    setCamOn(next)
  }

  function join() {
    if (!canJoin) return
    onJoin(roomInput.trim(), nameInput.trim(), {
      micId: selectedMic || undefined,
      camId: selectedCam || undefined,
      speakerId: SINK_SUPPORTED ? selectedSpeaker || undefined : undefined,
      micOn,
      camOn,
    })
  }
  function cancel() {
    setNameInput('')
    setRoomInput(randomRoom())
  }

  const stageClass = mirrored ? 'preview-stage mirrored' : 'preview-stage'

  return (
    <div className="lobby">
      <div className="lobby-top">
        <div className="lobby-brand">
          <span className="brand-dot" />
          <strong>Mesh</strong>
          <span className="brand-sub">Conference</span>
        </div>
        <button className="info-btn" title="About" aria-label="About">
          i
        </button>
      </div>

      <div className="lobby-body">
        {/* LEFT — camera preview + device controls */}
        <div className="lobby-preview">
          <div className={stageClass}>
            <Video stream={stream} muted className="preview-feed" />
            {!camOn && (
              <div className="preview-off">
                <Avatar name={nameInput || 'You'} />
              </div>
            )}
            <button
              className="stage-corner-btn"
              title="Mirror preview"
              onClick={() => setMirrored((m) => !m)}
            >
              ⤢
            </button>
          </div>

          {/* Device rows */}
          <div className="device-list">
            <div className="device-row">
              <span className="device-ico">🎙️</span>
              <span className="device-name">Microphone</span>
              <select
                className="device-select"
                value={selectedMic}
                onChange={(e) => switchDevice('audio', e.target.value)}
              >
                {mics.length === 0 && <option value="">Default microphone</option>}
                {mics.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
              <Switch on={micOn} onToggle={toggleMic} />
            </div>

            <div className="device-row">
              <span className="device-ico">📷</span>
              <span className="device-name">Camera</span>
              <select
                className="device-select"
                value={selectedCam}
                onChange={(e) => switchDevice('video', e.target.value)}
              >
                {cams.length === 0 && <option value="">Default camera</option>}
                {cams.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
              <Switch on={camOn} onToggle={toggleCam} />
            </div>

            <div className="device-row">
              <span className="device-ico">🔊</span>
              <span className="device-name">Speaker</span>
              <select
                className="device-select"
                value={selectedSpeaker}
                disabled={!SINK_SUPPORTED}
                title={SINK_SUPPORTED ? undefined : 'This browser uses the system default speaker'}
                onChange={(e) => setSelectedSpeaker(e.target.value)}
              >
                {!SINK_SUPPORTED && <option value="">Default speaker (system)</option>}
                {SINK_SUPPORTED && speakers.length === 0 && (
                  <option value="">Default speaker</option>
                )}
                {SINK_SUPPORTED &&
                  speakers.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
              </select>
              <button
                className="play-btn"
                title="Test speaker"
                onClick={() => playTestTone(selectedSpeaker)}
              >
                ▶
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT — join form */}
        <div className="lobby-card">
          <h2 className="card-title">Ready to join?</h2>

          {error && <div className="error">⚠ {error}</div>}

          <label className="field">
            <span className="field-label">Name</span>
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              placeholder="Your name"
              spellCheck={false}
              autoFocus
            />
          </label>

          <label className="field">
            <span className="field-label">Room ID</span>
            <div className="field-with-action">
              <input
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && join()}
                placeholder="room-id"
                spellCheck={false}
              />
              <button
                className="shuffle-btn"
                title="New random room ID"
                onClick={() => setRoomInput(randomRoom())}
              >
                🎲
              </button>
            </div>
          </label>

          <div className="card-actions">
            <button onClick={cancel}>Cancel</button>
            <button className="primary" onClick={join} disabled={!canJoin}>
              Join
            </button>
          </div>
        </div>
      </div>

      <footer className="lobby-footer">
        By joining you accept the Terms of Service &amp; Privacy Statement.
      </footer>
    </div>
  )
}
