// "The loading animation is on screen" — so heavy work can wait for it.
//
// A view that parses a large file on the main thread (SheetView: a 221 MB PSV
// holds it for seconds) used to start in the same task that mounted its
// loader, so the window never painted it: the reader saw an empty page, or the
// label without the animation. The animation itself is drawn by a worker
// (components/MobiusLoader.tsx) and keeps moving through a blocked main thread
// — but only once the page has been painted with its canvas in it. So such a
// view waits for `loaderShown()` first. Every wait is bounded: a hidden window
// paints nothing and fires no animation frames.

let drawn: Promise<void> = Promise.resolve()
let markDrawn: () => void = () => {}

/** A loader has mounted; its first frame is not drawn yet. */
export function loaderMounted(): void {
  drawn = new Promise(resolve => { markDrawn = resolve })
}

/** The loader that mounted last has drawn its first frame. */
export function loaderDrawn(): void {
  markDrawn()
}

/**
 * Resolves once the loader is drawn and the page has painted since — or after
 * `deadlineMs`, whichever comes first.
 */
export function loaderShown(deadlineMs = 500): Promise<void> {
  const painted = new Promise<void>(resolve => {
    if (typeof requestAnimationFrame !== 'function') { resolve(); return }
    // A task after the frame's callbacks runs after that frame was painted.
    requestAnimationFrame(() => setTimeout(resolve, 0))
  })
  const deadline = new Promise<void>(resolve => setTimeout(resolve, deadlineMs))
  return Promise.race([Promise.all([drawn, painted]).then(() => {}), deadline])
}
