/**
 * OCR input sizing. iOS Safari / WebKit enforces a tight per-tab memory budget,
 * and onnxruntime-web + OpenCV + a full-resolution page image blow past it —
 * WebKit then silently reloads the page mid-recognition (the document is lost,
 * no error fires). Feeding a much smaller image on iOS keeps peak memory under
 * the limit. Memory scales with image area, so halving each side ≈ quarters it.
 */

/** Detect iOS / iPadOS WebKit (Safari and in-app/Chrome, which all use WebKit). */
export function isIosWebkit(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const iOSDevice = /iPad|iPhone|iPod/.test(ua)
  // iPadOS 13+ reports as "MacIntel" but is a touch device.
  const iPadOS = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1
  return iOSDevice || iPadOS
}

/** Longest-side pixel cap for the OCR input image. Tiny on iOS to avoid OOM. */
export function ocrMaxDimension(): number {
  return isIosWebkit() ? 1024 : 2400
}

/**
 * Scale factor (0 < s ≤ 1) that fits a (width × height) image within `maxDim`
 * on its longest side. Returns 1 when it already fits (or is empty).
 */
export function computeOcrScale(width: number, height: number, maxDim: number): number {
  const longest = Math.max(width, height)
  if (longest <= 0 || longest <= maxDim) return 1
  return maxDim / longest
}
