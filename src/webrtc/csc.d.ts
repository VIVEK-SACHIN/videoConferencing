// Minimal typings for Chrome's Captured Surface Control API (Chrome 136+),
// which isn't in lib.dom yet.
// https://developer.chrome.com/docs/web-platform/captured-surface-control

interface CaptureController extends EventTarget {
  /** Forward wheel events from `element` to the captured surface, or stop with null. */
  forwardWheel(element: Element | null): Promise<void>
  /** Current zoom level (percentage), or null when unavailable. */
  readonly zoomLevel: number | null
  /** Monotonically increasing supported zoom percentages (includes 100). */
  getSupportedZoomLevels(): number[]
  increaseZoomLevel(): Promise<void>
  decreaseZoomLevel(): Promise<void>
  resetZoomLevel(): Promise<void>
  onzoomlevelchange: ((this: CaptureController, ev: Event) => unknown) | null
}

declare const CaptureController: {
  prototype: CaptureController
  new (): CaptureController
}

interface Window {
  CaptureController?: typeof CaptureController
}

// getDisplayMedia accepts a `controller` in supporting browsers.
interface DisplayMediaStreamOptions {
  controller?: CaptureController
}
