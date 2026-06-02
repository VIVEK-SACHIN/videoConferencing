import { useCallback, useEffect, useState } from 'react'

export type Device = { deviceId: string; label: string }
export type MediaDeviceLists = { mics: Device[]; cams: Device[]; speakers: Device[] }

/**
 * Enumerates available input/output devices and keeps the list fresh as devices
 * are plugged/unplugged (`devicechange`). Labels are only populated once media
 * permission has been granted; callers can force a re-read via `refresh`.
 */
export function useMediaDevices(): MediaDeviceLists & { refresh: () => void } {
  const [lists, setLists] = useState<MediaDeviceLists>({ mics: [], cams: [], speakers: [] })

  const refresh = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const pick = (kind: MediaDeviceKind, name: string): Device[] =>
        devices
          .filter((d) => d.kind === kind)
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${name} ${i + 1}` }))
      setLists({
        mics: pick('audioinput', 'Microphone'),
        cams: pick('videoinput', 'Camera'),
        speakers: pick('audiooutput', 'Speaker'),
      })
    } catch {
      /* ignore — enumeration is best-effort */
    }
  }, [])

  useEffect(() => {
    refresh()
    const md = navigator.mediaDevices
    md.addEventListener?.('devicechange', refresh)
    return () => md.removeEventListener?.('devicechange', refresh)
  }, [refresh])

  return { ...lists, refresh }
}
