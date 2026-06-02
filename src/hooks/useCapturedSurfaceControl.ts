import { useEffect, useState } from 'react'

/** True when the browser supports Captured Surface Control (Chrome 136+). */
export const CSC_SUPPORTED =
  typeof window !== 'undefined' && !!window.CaptureController?.prototype.forwardWheel

/**
 * Wires a tab-capture's CaptureController to a preview <video> so the presenter
 * can scroll (wheel-forwarding) and zoom the captured tab from the meeting UI.
 *
 * `canControl` only becomes true once a control call succeeds — it fails (and
 * stays false) for window/screen captures or when permission is denied, so the
 * UI can hide the zoom controls.
 */
export function useCapturedSurfaceControl(
  controller: CaptureController | null,
  videoEl: HTMLVideoElement | null,
) {
  const [zoomLevel, setZoomLevel] = useState<number | null>(null)
  const [canControl, setCanControl] = useState(false)

  // Forward wheel events from the preview to the captured surface.
  useEffect(() => {
    if (!CSC_SUPPORTED || !controller || !videoEl) return
    let cancelled = false
    controller
      .forwardWheel(videoEl)
      .then(() => {
        if (!cancelled) setCanControl(true)
      })
      .catch(() => {
        /* not a tab, or permission denied — controls stay hidden */
      })
    return () => {
      cancelled = true
      controller.forwardWheel(null).catch(() => {})
    }
  }, [controller, videoEl])

  // Track the zoom level.
  useEffect(() => {
    if (!CSC_SUPPORTED || !controller) return
    const sync = () => setZoomLevel(controller.zoomLevel ?? null)
    sync()
    controller.addEventListener('zoomlevelchange', sync)
    return () => controller.removeEventListener('zoomlevelchange', sync)
  }, [controller])

  const supportsZoom =
    canControl && !!controller && (controller.getSupportedZoomLevels?.().length ?? 0) > 1

  return {
    canControl,
    supportsZoom,
    zoomLevel,
    zoomIn: () => controller?.increaseZoomLevel().catch(() => {}),
    zoomOut: () => controller?.decreaseZoomLevel().catch(() => {}),
    resetZoom: () => controller?.resetZoomLevel().catch(() => {}),
  }
}
