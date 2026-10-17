import type { Annotation, CommentAnnotation, MarkupRect } from '../types/annotation'
import { isComment, isTextMarkup } from '../types/annotation'

/**
 * A page is drawn unrotated (W x H CSS px) and turned with a CSS transform
 * (see PdfPage `rotationStyle`); the text layers and the reader's selection
 * live in the turned box. These map between the two.
 *
 *   90:  unrotated (x, y) shows at (H - y, x)
 *   180:                          (W - x, H - y)
 *   270:                          (y, W - x)
 */
export function toDisplayed(x: number, y: number, W: number, H: number, rotation: number): { x: number; y: number } {
  switch (rotation) {
    case 90: return { x: H - y, y: x }
    case 180: return { x: W - x, y: H - y }
    case 270: return { x: y, y: W - x }
    default: return { x, y }
  }
}

export function fromDisplayed(sx: number, sy: number, W: number, H: number, rotation: number): { x: number; y: number } {
  switch (rotation) {
    case 90: return { x: sy, y: H - sx }
    case 180: return { x: W - sx, y: H - sy }
    case 270: return { x: W - sy, y: sx }
    default: return { x: sx, y: sy }
  }
}

/** A displayed rectangle back in unrotated page space (both corners, normalised). */
export function rectFromDisplayed(
  r: { left: number; top: number; right: number; bottom: number },
  W: number, H: number, rotation: number,
): MarkupRect {
  const a = fromDisplayed(r.left, r.top, W, H, rotation)
  const b = fromDisplayed(r.right, r.bottom, W, H, rotation)
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

/**
 * One rectangle per line. A selection's client rects come one per text span —
 * often several per line, overlapping, sometimes one per glyph run — and a
 * highlight saved like that has seams where the boxes overlap twice.
 * Boxes on the same line (vertical centres within half the shorter height)
 * that touch or nearly touch are joined.
 */
export function mergeLineRects(rects: MarkupRect[]): MarkupRect[] {
  const sorted = rects
    .filter(r => r.width > 0.5 && r.height > 0.5)
    .sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2) || a.x - b.x)
  const lines: MarkupRect[][] = []
  for (const r of sorted) {
    const cy = r.y + r.height / 2
    const line = lines.find(l => {
      const ref = l[0]
      return Math.abs(ref.y + ref.height / 2 - cy) <= Math.min(ref.height, r.height) / 2
    })
    if (line) line.push(r)
    else lines.push([r])
  }
  const out: MarkupRect[] = []
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x)
    let cur = { ...line[0] }
    for (const r of line.slice(1)) {
      const gap = r.height * 0.6
      if (r.x <= cur.x + cur.width + gap) {
        const right = Math.max(cur.x + cur.width, r.x + r.width)
        const top = Math.min(cur.y, r.y)
        const bottom = Math.max(cur.y + cur.height, r.y + r.height)
        cur = { x: cur.x, y: top, width: right - cur.x, height: bottom - top }
      } else {
        out.push(cur)
        cur = { ...r }
      }
    }
    out.push(cur)
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x)
}

/** The union of some rectangles. */
export function boundsOf(rects: MarkupRect[]): MarkupRect {
  const left = Math.min(...rects.map(r => r.x))
  const top = Math.min(...rects.map(r => r.y))
  const right = Math.max(...rects.map(r => r.x + r.width))
  const bottom = Math.max(...rects.map(r => r.y + r.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * The reader's selection, as marked lines on this page in PDF points — or
 * null when it is empty or lies elsewhere. `page` is the page's outer box
 * (the turned one); W/H the unrotated size in CSS px.
 */
export function selectionToRects(
  clientRects: ArrayLike<DOMRect>,
  page: DOMRect,
  W: number, H: number, rotation: number, effectiveZoom: number,
): MarkupRect[] {
  const rects: MarkupRect[] = []
  for (let i = 0; i < clientRects.length; i++) {
    const c = clientRects[i]
    // Off the page (a selection that ran past it) or degenerate.
    const left = Math.max(c.left, page.left) - page.left
    const top = Math.max(c.top, page.top) - page.top
    const right = Math.min(c.right, page.right) - page.left
    const bottom = Math.min(c.bottom, page.bottom) - page.top
    if (right - left < 1 || bottom - top < 1) continue
    // pdf.js puts an end-of-content element across the whole layer; a box
    // that tall is never a line of text.
    if (bottom - top > page.height * 0.5) continue
    const r = rectFromDisplayed({ left, top, right, bottom }, W, H, rotation)
    rects.push({ x: r.x / effectiveZoom, y: r.y / effectiveZoom, width: r.width / effectiveZoom, height: r.height / effectiveZoom })
  }
  return mergeLineRects(rects)
}

/** The comment under a point on the page (PDF points), topmost first. */
export function commentAt(annotations: Annotation[], page: number, x: number, y: number): CommentAnnotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i]
    if (a.page !== page || !isComment(a)) continue
    const boxes = isTextMarkup(a) ? a.rects : [a]
    if (boxes.some(r => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)) return a
  }
  return null
}

/**
 * The text a selection covers, as a reader would quote it. `toString()` runs
 * the text layer's pieces together: pdf.js ends a line with a <br>, which has
 * no text, and OCR / HWP words are separate boxes with no space between them.
 */
export function rangeText(range: Range): string {
  const frag = range.cloneContents()
  frag.querySelectorAll('br').forEach(br => br.replaceWith(' '))
  frag.querySelectorAll('.wz-ocr-span').forEach(s => s.append(' '))
  return (frag.textContent ?? '').replace(/\s+/g, ' ').trim()
}
