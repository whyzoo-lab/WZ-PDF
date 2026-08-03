/**
 * Printing for the reflowing formats (Markdown, mail).
 *
 * The page-based path in `usePrint` rasterises each page and prints the images,
 * because that is the only way to get a PDF page onto paper exactly as drawn.
 * A reflowing document has no pages to rasterise, and rasterising it would be a
 * downgrade: the browser already knows how to break text across sheets, and
 * text printed as text stays vector-sharp and selectable in a "print to PDF".
 *
 * So this path prints the DOM. It reuses `usePrint`'s `#wz-print-root` +
 * `data-wz-printing` mechanism — the print stylesheet hides the app shell and
 * shows only that container — and clones the live document into it.
 */

/** Marker the reflowing views put on the element that should reach the printer. */
export const FLOW_PRINT_ATTR = 'data-wz-flow-print'

/**
 * Wait for every image in the clone to be decoded.
 *
 * The clone starts its own loads, so without this the print dialog can capture
 * the document before the pictures are in it — the same class of bug the page
 * path avoids by decoding its data URLs up front. A single image that fails to
 * load must not block the whole print, hence the per-image catch.
 */
/**
 * Nothing on the way to the print dialog may wait forever.
 *
 * By the time these run, `data-wz-printing` has already hidden the app shell —
 * so a promise that never settles doesn't just delay the print, it strands the
 * user on a blank window with no dialog and no way back. Both waits below are
 * conveniences (sharper images, one settled frame), and both have a failure
 * mode that is silent and indefinite rather than an error: `requestAnimationFrame`
 * and `HTMLImageElement.decode()` are driven by the compositor, which stops
 * while the window is occluded or backgrounded. Printing is exactly the moment
 * a user might click away.
 */
function withDeadline(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise(resolve => {
    const done = () => resolve()
    void work.then(done, done)
    setTimeout(done, ms)
  })
}

const IMAGE_DECODE_DEADLINE_MS = 3000
const FRAME_DEADLINE_MS = 50

async function decodeImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.all(imgs.map(img => {
    // `decode()` rejects on a broken image and can throw outright where it
    // isn't implemented. Neither is a reason to refuse to print the text.
    let work: Promise<unknown>
    try { work = img.decode() } catch { return }
    return withDeadline(work, IMAGE_DECODE_DEADLINE_MS)
  }))
}

/** One frame, so the print stylesheet is applied before the dialog opens. */
function nextFrame(): Promise<void> {
  return withDeadline(
    new Promise(resolve => requestAnimationFrame(() => resolve(null))),
    FRAME_DEADLINE_MS,
  )
}

/**
 * Print the currently displayed reflowing document.
 *
 * Returns false when there is nothing marked printable, so the caller can fall
 * through to the page-based path instead of silently doing nothing.
 */
export async function printFlowDoc(): Promise<boolean> {
  const source = document.querySelector<HTMLElement>(`[${FLOW_PRINT_ATTR}]`)
  if (!source) return false

  const root = document.createElement('div')
  root.id = 'wz-print-root'
  root.appendChild(source.cloneNode(true))

  // The global `@page { margin: 0 }` exists so a rasterised page image can fill
  // the sheet edge to edge. Text needs real margins, and `@page` cannot be
  // scoped by a selector — so the override is injected for the duration of this
  // print and removed again afterwards.
  const pageStyle = document.createElement('style')
  pageStyle.textContent = '@page { margin: 14mm; }'

  try {
    document.head.appendChild(pageStyle)
    document.body.appendChild(root)
    document.body.setAttribute('data-wz-printing', '')
    document.body.setAttribute('data-wz-flow-printing', '')

    await decodeImages(root)
    await nextFrame()

    // Returns after the dialog closes, which the cleanup below relies on.
    window.print()
  } finally {
    document.body.removeAttribute('data-wz-printing')
    document.body.removeAttribute('data-wz-flow-printing')
    root.remove()
    pageStyle.remove()
  }
  return true
}
