import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFPage, PDFRef, PDFString } from '@cantoo/pdf-lib'
import type { CommentAnnotation, CommentReply, MarkupRect, NoteAnnotation, TextMarkupAnnotation } from '../types/annotation'
import { isTextMarkup } from '../types/annotation'
import { hexToRgb } from '../utils/coordinates'

/**
 * Highlights, underlines, strike-throughs and notes as real PDF annotations —
 * not drawn into the page — so any reader lists them as comments, shows the
 * thread, and can edit or delete them. Laid out after PdfCraft's
 * `crates/annot` (appearance streams so they look the same everywhere) and
 * Acrobat's own output (replies as /IRT annotations, "done" as a /State reply).
 *
 * Coordinates: annotations are stored in the page's *viewport* at scale 1 —
 * what pdf.js shows, with the page's /Rotate applied and the CropBox at the
 * origin, top-down. PDF annotations live in default user space, bottom-up and
 * unrotated; `viewportToPdf` is pdf.js's viewport transform, inverted.
 */

type Pt = [number, number]

export interface PageSpace {
  /** The visible box (CropBox ∩ MediaBox), PDF user space. */
  box: { x: number; y: number; width: number; height: number }
  /** /Rotate, normalised to 0 | 90 | 180 | 270. */
  rotate: number
}

export function pageSpaceOf(page: PDFPage): PageSpace {
  const crop = page.getCropBox()
  const media = page.getMediaBox()
  const x = Math.max(crop.x, media.x)
  const y = Math.max(crop.y, media.y)
  const right = Math.min(crop.x + crop.width, media.x + media.width)
  const top = Math.min(crop.y + crop.height, media.y + media.height)
  const rotate = (((page.getRotation().angle % 360) + 360) % 360)
  return { box: { x, y, width: right - x, height: top - y }, rotate }
}

/** A viewport point (scale 1, top-down, /Rotate applied) in PDF user space. */
export function viewportToPdf(space: PageSpace, X: number, Y: number): Pt {
  const { x, y, width: w, height: h } = space.box
  switch (space.rotate) {
    case 90: return [x + Y, y + X]
    case 180: return [x + w - X, y + Y]
    case 270: return [x + w - Y, y + h - X]
    default: return [x + X, y + h - Y]
  }
}

/** The four corners of a line, in the order /QuadPoints wants: UL, UR, LL, LR (as read). */
function quadOf(space: PageSpace, r: MarkupRect): [Pt, Pt, Pt, Pt] {
  return [
    viewportToPdf(space, r.x, r.y),
    viewportToPdf(space, r.x + r.width, r.y),
    viewportToPdf(space, r.x, r.y + r.height),
    viewportToPdf(space, r.x + r.width, r.y + r.height),
  ]
}

const n = (v: number) => (Math.round(v * 1000) / 1000).toString()
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** PDF date string, UTC. */
export function pdfDate(ms: number): string {
  const d = new Date(ms)
  const p = (v: number, l = 2) => String(v).padStart(l, '0')
  return `D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

const text = (s: string) => PDFHexString.fromText(s)
/** Dates and ids are ASCII and must stay plain strings: readers do not decode UTF-16 there. */
const ascii = (s: string) => PDFString.of(s)

function bboxOf(points: Pt[], pad: number): [number, number, number, number] {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1])
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]
}

/**
 * What the markup looks like, as a form XObject in page space. A highlight is
 * filled under Multiply blending, so text stays black under the colour
 * instead of being washed out; lines follow each quad's own orientation, so
 * they sit under the text on a rotated page too.
 */
function markupAppearance(doc: PDFDocument, a: TextMarkupAnnotation, quads: [Pt, Pt, Pt, Pt][], bbox: number[]): PDFRef {
  const [r, g, b] = hexToRgb(a.color)
  const ops: string[] = []
  if (a.type === 'highlight') {
    ops.push('/GS0 gs', `${n(r)} ${n(g)} ${n(b)} rg`)
    for (const [ul, ur, ll, lr] of quads) {
      ops.push(`${n(ul[0])} ${n(ul[1])} m ${n(ur[0])} ${n(ur[1])} l ${n(lr[0])} ${n(lr[1])} l ${n(ll[0])} ${n(ll[1])} l h f`)
    }
  } else {
    ops.push(`${n(r)} ${n(g)} ${n(b)} RG`)
    for (const [ul, ur, ll, lr] of quads) {
      const height = Math.hypot(ul[0] - ll[0], ul[1] - ll[1])
      // Underline just under the glyphs; strike-through a little above the middle.
      const t = a.type === 'underline' ? 0.9 : 0.55
      const from = lerp(ul, ll, t), to = lerp(ur, lr, t)
      ops.push(`${n(Math.max(0.5, height * 0.07))} w`, `${n(from[0])} ${n(from[1])} m ${n(to[0])} ${n(to[1])} l S`)
    }
  }
  return doc.context.register(doc.context.stream(ops.join('\n'), {
    Type: 'XObject', Subtype: 'Form', BBox: bbox,
    Resources: { ExtGState: { GS0: { Type: 'ExtGState', BM: 'Multiply', CA: 1, ca: 1 } } },
  }))
}

/** A folded-corner note, the colour of the note, 20 x 20. */
function noteAppearance(doc: PDFDocument, color: string, size: number): PDFRef {
  const [r, g, b] = hexToRgb(color)
  const s = size
  const ops = [
    `${n(r)} ${n(g)} ${n(b)} rg 0.25 0.25 0.25 RG 0.8 w`,
    `1 1 m ${n(s - 1)} 1 l ${n(s - 1)} ${n(s - 6)} l ${n(s - 6)} ${n(s - 1)} l 1 ${n(s - 1)} l h B`,
    `${n(s - 6)} ${n(s - 1)} m ${n(s - 6)} ${n(s - 6)} l ${n(s - 1)} ${n(s - 6)} l S`,
    `0.6 w 4 ${n(s * 0.62)} m ${n(s - 9)} ${n(s * 0.62)} l S 4 ${n(s * 0.45)} m ${n(s - 4)} ${n(s * 0.45)} l S 4 ${n(s * 0.28)} m ${n(s - 4)} ${n(s * 0.28)} l S`,
  ]
  return doc.context.register(doc.context.stream(ops.join('\n'), { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, s, s] }))
}

/** An appearance that draws nothing — for replies, which live in the thread, not on the page. */
function emptyAppearance(doc: PDFDocument): PDFRef {
  return doc.context.register(doc.context.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1] }))
}

// Annotation flags: Print (4), NoZoom (8), NoRotate (16).
const F_PRINT = 4
const F_NOTE = 4 | 8 | 16

interface Written { ref: PDFRef; rect: number[] }

function addCommon(a: { contents: string; author: string; createdAt: number; modifiedAt?: number; id: string }) {
  return {
    Type: 'Annot',
    Contents: text(a.contents),
    T: text(a.author),
    NM: ascii(a.id.replace(/[^\x20-\x7e]/g, '')),
    M: ascii(pdfDate(a.modifiedAt ?? a.createdAt)),
    CreationDate: ascii(pdfDate(a.createdAt)),
  }
}

function writeMarkup(doc: PDFDocument, page: PDFPage, space: PageSpace, a: TextMarkupAnnotation): Written | null {
  if (a.rects.length === 0) return null
  const quads = a.rects.map(r => quadOf(space, r))
  const flat = quads.flatMap(q => q.flatMap(p => p))
  const rect = bboxOf(quads.flat(), 1)
  const ap = markupAppearance(doc, a, quads, rect)
  const subtype = a.type === 'highlight' ? 'Highlight' : a.type === 'underline' ? 'Underline' : 'StrikeOut'
  const dict = doc.context.obj({
    ...addCommon(a),
    Subtype: subtype,
    Rect: rect,
    QuadPoints: flat,
    C: hexToRgb(a.color),
    CA: 1,
    F: F_PRINT,
    P: page.ref,
    AP: { N: ap },
  })
  return { ref: doc.context.register(dict), rect }
}

function writeNote(doc: PDFDocument, page: PDFPage, space: PageSpace, a: NoteAnnotation): Written {
  // The icon stays upright (NoRotate): anchor its top-left where it was put.
  const [x, y] = viewportToPdf(space, a.x, a.y)
  const s = a.width
  const rect = space.rotate === 0 ? [x, y - s, x + s, y]
    : space.rotate === 90 ? [x, y, x + s, y + s]
      : space.rotate === 180 ? [x - s, y, x, y + s]
        : [x - s, y - s, x, y]
  const dict = doc.context.obj({
    ...addCommon(a),
    Subtype: 'Text',
    Name: 'Comment',
    Rect: rect,
    C: hexToRgb(a.color),
    F: F_NOTE,
    Open: false,
    P: page.ref,
    AP: { N: noteAppearance(doc, a.color, s) },
  })
  return { ref: doc.context.register(dict), rect }
}

/** The pop-up window a reader opens the comment in, beside it and on the page. */
function writePopup(doc: PDFDocument, page: PDFPage, space: PageSpace, parent: Written): PDFRef {
  const { x, y, width, height } = space.box
  const w = Math.min(220, width), h = Math.min(120, height)
  const left = Math.min(Math.max(parent.rect[2] + 4, x), x + width - w)
  const top = Math.min(Math.max(parent.rect[3], y + h), y + height)
  return doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Popup', Rect: [left, top - h, left + w, top], Parent: parent.ref, Open: false, F: 0, P: page.ref,
  }))
}

function writeReply(doc: PDFDocument, page: PDFPage, parent: Written, reply: CommentReply, ap: PDFRef): PDFRef {
  return doc.context.register(doc.context.obj({
    ...addCommon(reply),
    Subtype: 'Text', Name: 'Comment', Rect: parent.rect, IRT: parent.ref, RT: 'R',
    F: F_NOTE, Open: false, P: page.ref, AP: { N: ap },
  }))
}

/** Acrobat's "completed" status: a reply carrying a review state. */
function writeDone(doc: PDFDocument, page: PDFPage, parent: Written, a: CommentAnnotation, ap: PDFRef): PDFRef {
  const dict = doc.context.obj({
    ...addCommon({ id: `${a.id}-state`, contents: '', author: a.author, createdAt: a.modifiedAt ?? a.createdAt }),
    Subtype: 'Text', Name: 'Comment', Rect: parent.rect, IRT: parent.ref,
    F: F_NOTE | 2 /* Hidden */, Open: false, P: page.ref, AP: { N: ap },
  })
  dict.set(PDFName.of('State'), ascii('Completed'))
  dict.set(PDFName.of('StateModel'), ascii('Review'))
  return doc.context.register(dict)
}

/** Write a page's comments as annotations of that page, after whatever it already has. */
export function addCommentAnnotations(doc: PDFDocument, page: PDFPage, comments: CommentAnnotation[]): void {
  if (comments.length === 0) return
  const space = pageSpaceOf(page)
  let empty: PDFRef | null = null
  const blank = () => (empty ??= emptyAppearance(doc))
  for (const a of comments) {
    const written = isTextMarkup(a) ? writeMarkup(doc, page, space, a) : writeNote(doc, page, space, a)
    if (!written) continue
    page.node.addAnnot(written.ref)
    const popup = writePopup(doc, page, space, written)
    doc.context.lookup(written.ref, PDFDict)?.set(PDFName.of('Popup'), popup)
    page.node.addAnnot(popup)
    for (const reply of a.replies) page.node.addAnnot(writeReply(doc, page, written, reply, blank()))
    if (a.done) page.node.addAnnot(writeDone(doc, page, written, a, blank()))
  }
}
