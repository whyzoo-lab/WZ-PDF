/**
 * `fn`, at most once per animation frame, however often the result is called.
 *
 * For scroll handlers that measure: a wheel notch can fire several scroll
 * events before the next paint, and only the last position is worth reading.
 * Call `cancel` when the listener goes, or a pending frame runs after unmount.
 */
export function onceAFrame(fn: () => void): (() => void) & { cancel(): void } {
  let frame = 0
  const run = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      fn()
    })
  }
  run.cancel = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }
  return run
}
