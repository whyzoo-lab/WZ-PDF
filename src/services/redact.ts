// Redaction that removes, not covers. A black box drawn over text leaves the
// text in the file — selectable, searchable, copyable; that is the classic
// leak. Applying marks here rebuilds each marked page from a picture of
// itself with the boxes painted in, so nothing that was under a box exists
// in the file any more:
//  - the page's own content (text, fonts, images, vectors) is replaced by one
//    image drawn with the boxes already black;
//  - the page's text outside the boxes comes back as invisible text, so the
//    rest of the page is still searchable and copyable;
//  - annotations, links and form fields whose box touches a mark are removed;
//  - optionally, the document's hidden information goes too (properties,
//    XMP metadata, attachments, scripts, private data).
// Then the result is read back and checked: if any text is still found under
// a mark, nothing is returned (fail-closed, as PdfCraft's `crates/redact`).
//
// PdfCraft cuts glyphs and image pixels out of the content itself, keeping
// vector quality; rewriting content streams is the part not taken over here.
// A redacted page becomes a picture at REDACT_DPI — larger and no longer
// vector, the price of a removal that cannot miss.

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFPage, PDFRef } from '@cantoo/pdf-lib'
import type { MarkupRect } from '../types/annotation'
import type { PlacedRun } from './ocrTextLayer'
import { loadPdfForWriting } from './pdfLoad'
import { pageSpaceOf, viewportToPdf, type PageSpace } from './pdfComments'
import { collectGarbage, pruneRemovedPages } from './pdfStructure'
import { embedTextFont, drawInvisibleRuns } from './pdfExporter'

/** Resolution a redacted page is redrawn at. */
export const REDACT_DPI = 300

/** Marks on one page (1-based), in viewport points (the page as shown, /Rotate applied). */
export interface PageMarks { page: number; rects: MarkupRect[] }

/** One word of the page with its box in viewport points — the text kept outside the marks. */
export interface PageWord { text: string; rect: MarkupRect }

/** The page drawn, unrotated (as user space lies), boxes painted — encoded. */
export interface RenderedPage { bytes: Uint8Array; type: 'jpeg' | 'png' }

export interface RedactOptions {
  password?: string
  /** Draw page `n` without its annotations, at `scale` px per point, unrotated, with these boxes (unrotated px) filled black. */
  render: (page: number, scale: number, boxes: { x: number; y: number; width: number; height: number }[]) => Promise<RenderedPage>
  /** The page's words with boxes (viewport points). */
  words: (page: number) => Promise<PageWord[]>
  /** Remove properties, metadata, attachments, scripts and private data too. */
  removeHidden?: boolean
  /** Read the result back and say whether any text is still under a mark. */
  verify?: (bytes: Uint8Array, marks: PageMarks[]) => Promise<number>
}

export interface RedactReport {
  pages: number
  boxes: number
  wordsRemoved: number
  annotationsRemoved: number
  hiddenRemoved: string[]
}

const N = (s: string) => PDFName.of(s)

export function intersects(a: MarkupRect, b: MarkupRect, pad = 0): boolean {
  return a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad
}

/** A viewport rectangle in PDF user space ([x1, y1, x2, y2]). */
function toUser(space: PageSpace, r: MarkupRect): [number, number, number, number] {
  const a = viewportToPdf(space, r.x, r.y)
  const b = viewportToPdf(space, r.x + r.width, r.y + r.height)
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
}

function annotationRect(page: PDFPage, ref: unknown): [number, number, number, number] | null {
  const d = ref instanceof PDFRef ? page.doc.context.lookup(ref) : ref
  if (!(d instanceof PDFDict)) return null
  const r = d.lookup(N('Rect'))
  if (!(r instanceof PDFArray) || r.size() < 4) return null
  const v = r.asArray().map(o => Number((o as { asNumber?: () => number }).asNumber?.() ?? NaN))
  if (v.some(n => !Number.isFinite(n))) return null
  return [Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])]
}

const overlapsUser = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

/** Take off a page every annotation whose box touches a mark — with its pop-up. Returns how many. */
function dropTouchingAnnotations(page: PDFPage, marks: [number, number, number, number][]): number {
  const annots = page.node.lookup(N('Annots'))
  if (!(annots instanceof PDFArray)) return 0
  const gone = new Set<string>()
  for (const ref of annots.asArray()) {
    const r = annotationRect(page, ref)
    if (r && marks.some(m => overlapsUser(r, m))) {
      gone.add(String(ref))
      const d = ref instanceof PDFRef ? page.doc.context.lookup(ref) : ref
      const popup = d instanceof PDFDict ? d.get(N('Popup')) : undefined
      if (popup) gone.add(String(popup))
    }
  }
  // Pop-ups and replies whose parent went.
  for (const ref of annots.asArray()) {
    const d = ref instanceof PDFRef ? page.doc.context.lookup(ref) : ref
    if (!(d instanceof PDFDict)) continue
    const parent = d.get(N('Parent')) ?? d.get(N('IRT'))
    if (parent && gone.has(String(parent))) gone.add(String(ref))
  }
  let n = 0
  for (let i = annots.size() - 1; i >= 0; i--) if (gone.has(String(annots.get(i)))) { annots.remove(i); n++ }
  return n
}

/** Remove what a document carries besides its pages. Returns the kinds removed. */
export function removeHiddenInformation(doc: PDFDocument): string[] {
  const removed: string[] = []
  const info = doc.context.trailerInfo.Info
  if (info) {
    const d = info instanceof PDFRef ? doc.context.lookup(info) : info
    if (d instanceof PDFDict && d.keys().length > 0) {
      for (const k of d.keys()) d.delete(k)
      removed.push('properties')
    }
  }
  if (doc.catalog.has(N('Metadata'))) { doc.catalog.delete(N('Metadata')); removed.push('metadata') }
  const names = doc.catalog.lookup(N('Names'))
  if (names instanceof PDFDict) {
    if (names.has(N('EmbeddedFiles'))) { names.delete(N('EmbeddedFiles')); removed.push('attachments') }
    if (names.has(N('JavaScript'))) { names.delete(N('JavaScript')); removed.push('scripts') }
  }
  for (const k of ['OpenAction', 'AA']) if (doc.catalog.has(N(k))) { doc.catalog.delete(N(k)); if (!removed.includes('scripts')) removed.push('scripts') }
  if (doc.catalog.has(N('PieceInfo'))) { doc.catalog.delete(N('PieceInfo')); removed.push('private data') }
  for (const page of doc.getPages()) {
    for (const k of ['PieceInfo', 'Metadata', 'AA', 'Thumb']) {
      if (page.node.has(N(k))) { page.node.delete(N(k)); if (!removed.includes('private data')) removed.push('private data') }
    }
    // File attachment annotations carry files.
    const annots = page.node.lookup(N('Annots'))
    if (annots instanceof PDFArray) {
      for (let i = annots.size() - 1; i >= 0; i--) {
        const d = annots.lookup(i)
        if (d instanceof PDFDict && d.get(N('Subtype')) === N('FileAttachment')) { annots.remove(i); if (!removed.includes('attachments')) removed.push('attachments') }
      }
    }
  }
  // pdf-lib writes its Producer and dates into /Info when it loads a file,
  // so clearing /Info after loading leaves it empty in what is saved.
  return removed
}

/**
 * Apply the marks. Pages without marks are left exactly as they were.
 * Throws when the result does not verify, so the caller keeps the document.
 */
export async function applyRedactions(bytes: ArrayBuffer, marks: PageMarks[], opts: RedactOptions): Promise<{ bytes: Uint8Array; report: RedactReport }> {
  const byPage = new Map<number, MarkupRect[]>()
  for (const m of marks) if (m.rects.length) byPage.set(m.page, [...(byPage.get(m.page) ?? []), ...m.rects])
  if (byPage.size === 0) throw new Error('nothing to apply')

  const doc = await loadPdfForWriting(bytes, opts.password)
  const pages = doc.getPages()
  const report: RedactReport = { pages: 0, boxes: 0, wordsRemoved: 0, annotationsRemoved: 0, hiddenRemoved: [] }
  const scale = REDACT_DPI / 72
  let font: Awaited<ReturnType<typeof embedTextFont>> | null = null

  for (const [pageNumber, rects] of byPage) {
    const page = pages[pageNumber - 1]
    if (!page) continue
    const space = pageSpaceOf(page)
    const user = rects.map(r => toUser(space, r))
    // The boxes in the unrotated picture's pixels.
    const { x: bx, y: by, height: bh } = space.box
    const boxes = user.map(([x1, y1, x2, y2]) => ({ x: (x1 - bx) * scale, y: (by + bh - y2) * scale, width: (x2 - x1) * scale, height: (y2 - y1) * scale }))
    const picture = await opts.render(pageNumber, scale, boxes)

    // The page's text outside the marks, kept as invisible text.
    const words = await opts.words(pageNumber)
    const kept = words.filter(w => !rects.some(r => intersects(w.rect, r, 0.5)))
    report.wordsRemoved += words.length - kept.length

    // The new page content: the picture, full size, nothing else.
    const image = picture.type === 'jpeg' ? await doc.embedJpg(picture.bytes) : await doc.embedPng(picture.bytes)
    const content = doc.context.flateStream(`q ${space.box.width} 0 0 ${space.box.height} ${bx} ${by} cm /WzRedacted Do Q\n`)
    page.node.set(N('Contents'), doc.context.register(content))
    page.node.set(N('Resources'), doc.context.obj({ XObject: { WzRedacted: image.ref } }))
    for (const k of ['Group', 'PieceInfo', 'Thumb', 'StructParents']) page.node.delete(N(k))

    if (kept.length) {
      font ??= await embedTextFont(doc)
      drawInvisibleRuns(page, font, kept.map(w => wordRun(space, w)))
    }
    report.annotationsRemoved += dropTouchingAnnotations(page, user)
    report.pages++
    report.boxes += rects.length
  }

  // Fields and links whose widgets went; then forget the old content.
  pruneRemovedPages(doc)
  if (opts.removeHidden) report.hiddenRemoved = removeHiddenInformation(doc)
  collectGarbage(doc)
  const out = await doc.save()

  if (opts.verify) {
    const left = await opts.verify(out, marks)
    if (left > 0) throw new RedactionNotVerified(left)
  }
  return { bytes: out, report }
}

export class RedactionNotVerified extends Error {
  readonly left: number
  constructor(left: number) {
    super(`${left} item(s) were still found under the marks`)
    this.left = left
  }
}

/** A word kept outside the marks, as invisible text placed where it was. */
function wordRun(space: PageSpace, w: PageWord): PlacedRun {
  const r = w.rect
  // Baseline near the bottom of the box, turned with a /Rotate page.
  const [x, y] = viewportToPdf(space, r.x, r.y + r.height * 0.82)
  return { text: w.text, x, y, width: r.width, height: r.height, angle: space.rotate }
}

// ── Finding what to redact ──────────────────────────────────────────────────

export interface RedactPattern { id: string; re: RegExp; check?: (m: string) => boolean }

function luhn(s: string): boolean {
  const d = s.replace(/\D/g, '')
  if (d.length < 13 || d.length > 19) return false
  let sum = 0
  for (let i = 0; i < d.length; i++) {
    let n = +d[d.length - 1 - i]
    if (i % 2) { n *= 2; if (n > 9) n -= 9 }
    sum += n
  }
  return sum % 10 === 0
}

/** Personal information as written in Korean documents. */
export const REDACT_PATTERNS: RedactPattern[] = [
  { id: 'rrn', re: /(?<!\d)\d{6}\s?[-–]\s?[1-8]\d{6}(?!\d)/g },
  { id: 'mobile', re: /(?<!\d)01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)/g },
  { id: 'phone', re: /(?<!\d)(?:02|0[3-6][1-5]|070|1[56]\d\d)[\s.)-]?\d{3,4}[\s.-]?\d{4}(?!\d)/g },
  { id: 'email', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { id: 'card', re: /(?<!\d)(?:\d{4}[\s-]?){3}\d{1,4}(?!\d)/g, check: luhn },
  { id: 'bizno', re: /(?<!\d)\d{3}-\d{2}-\d{5}(?!\d)/g },
]

/** Escape text for a literal search. */
export function literal(text: string): RegExp {
  return new RegExp(text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'gi')
}

export interface Found { page: number; text: string; rects: MarkupRect[]; pattern: string }

/**
 * Where a pattern matches a page's words: the words are joined with spaces
 * (so a number written across two words still matches), and each match is
 * marked over the part of each word it covers — a share of the word's box by
 * character count, so "연락처:010-1234-5678" is marked from the number on.
 */
export function findInWords(page: number, words: PageWord[], patterns: RedactPattern[]): Found[] {
  let text = ''
  const starts: number[] = []
  for (const w of words) { if (text) text += ' '; starts.push(text.length); text += w.text }
  const out: Found[] = []
  for (const p of patterns) {
    p.re.lastIndex = 0
    for (const m of text.matchAll(new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g'))) {
      if (!m[0].trim() || (p.check && !p.check(m[0]))) continue
      const s = m.index ?? 0, e = s + m[0].length
      const rects: MarkupRect[] = []
      words.forEach((w, i) => {
        const ws = starts[i], we = ws + w.text.length
        const from = Math.max(s, ws), to = Math.min(e, we)
        if (to <= from) return
        const n = w.text.length || 1
        rects.push({ x: w.rect.x + (w.rect.width * (from - ws)) / n, y: w.rect.y, width: (w.rect.width * (to - from)) / n, height: w.rect.height })
      })
      if (rects.length) out.push({ page, text: m[0], rects, pattern: p.id })
    }
  }
  return out
}
