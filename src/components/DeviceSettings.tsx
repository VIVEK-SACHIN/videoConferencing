import { useMediaDevices } from '../hooks/useMediaDevices'
import { SINK_SUPPORTED, playTestTone } from '../utils/media'

/**
 * In-call device switcher. Lists current devices and lets the user change
 * camera / microphone (live, via replaceTrack) and speaker (via setSinkId)
 * without leaving the meeting.
 */
export function DeviceSettings({
  micId,
  camId,
  speakerId,
  onSelectMic,
  onSelectCamera,
  onSelectSpeaker,
  onClose,
}: {
  micId: string | null
  camId: string | null
  speakerId: string | null
  onSelectMic: (deviceId: string) => void
  onSelectCamera: (deviceId: string) => void
  onSelectSpeaker: (deviceId: string) => void
  onClose: () => void
}) {
  const { mics, cams, speakers } = useMediaDevices()

  return (
    <div className="fs-settings">
      <div className="fs-settings-head">
        <span>Devices</span>
        <button className="fs-chat-close" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      <div className="device-row">
        <span className="device-ico">🎙️</span>
        <span className="device-name">Microphone</span>
        <select
          className="device-select"
          value={micId ?? ''}
          onChange={(e) => onSelectMic(e.target.value)}
        >
          {mics.length === 0 && <option value="">Default microphone</option>}
          {mics.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      <div className="device-row">
        <span className="device-ico">📷</span>
        <span className="device-name">Camera</span>
        <select
          className="device-select"
          value={camId ?? ''}
          onChange={(e) => onSelectCamera(e.target.value)}
        >
          {cams.length === 0 && <option value="">Default camera</option>}
          {cams.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      <div className="device-row">
        <span className="device-ico">🔊</span>
        <span className="device-name">Speaker</span>
        <select
          className="device-select"
          value={speakerId ?? ''}
          disabled={!SINK_SUPPORTED}
          title={SINK_SUPPORTED ? undefined : 'This browser uses the system default speaker'}
          onChange={(e) => onSelectSpeaker(e.target.value)}
        >
          {!SINK_SUPPORTED && <option value="">Default speaker (system)</option>}
          {SINK_SUPPORTED && speakers.length === 0 && <option value="">Default speaker</option>}
          {SINK_SUPPORTED &&
            speakers.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
        </select>
        <button className="play-btn" title="Test speaker" onClick={() => playTestTone(speakerId)}>
          ▶
        </button>
      </div>
    </div>
  )
}
