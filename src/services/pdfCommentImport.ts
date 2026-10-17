// Comments a PDF already has — from Acrobat, Edge, another reviewer, or this
// app's last save — opened as editable comments rather than ink baked into
// the page.
//
// Three parts, after PdfCraft's annotation round trip:
//  1. Hide: before a page is drawn, the comments on it are marked `noView` /
//     `noPrint` in pdf.js's annotation storage, and every render of a PDF asks
//     for the storage (`COMMENT_RENDER`). The page picture then has no
//     comments in it, so nothing shows twice and an edited or deleted comment
//     does not linger underneath.
//  2. Read: `importComments` turns the same annotations into app comments —
//     marked lines in viewport points, the thread from /IRT replies, "done"
//     from a /State reply, the marked text from the page's text.
//  3. Replace: on save the original objects (`refs`) are taken off their pages
//     and the comments are written anew (services/pdfComments).

import type { ViewerDoc } from '../types/viewerDoc'
import type { CommentAnnotation, CommentReply, MarkupRect, OmitId, TextMarkupType } from '../types/annotation'
import { MARKUP_COLORS, NOTE_SIZE } from '../types/annotation'
import { mergeLineRects } from '../utils/pageGeometry'
import { isFillableWidget } from './pdfForms'

/** pdf.js AnnotationMode.ENABLE_STORAGE: draw annotations, honouring the storage. */
export const COMMENT_RENDER = { annotationMode: 3 } as const

const MARKUP_SUBTYPES: Record<string, TextMarkupType> = {
  Highlight: 'highlight', Underline: 'underline', StrikeOut: 'strikeout', Squiggly: 'underline',
}

// Annotation flags: Hidden (2), NoView (32).
const HIDDEN = 2 | 32

/** The subset of pdf.js's annotation data used here. */
interface RawAnnotation {
  id: string
  subtype: string
  rect: number[]
  quadPoints?: ArrayLike<number> | null
  color?: ArrayLike<number> | null
  contentsObj?: { str: string } | null
  titleObj?: { str: string } | null
  creationDate?: string | null
  modificationDate?: string | null
  inReplyTo?: string | null
  popupRef?: string | null
  annotationFlags?: number
  state?: string | null
  stateModel?: string | null
}

interface PdfjsViewport {
  convertToViewportPoint(x: number, y: number): number[]
}

interface PdfjsPage {
  getAnnotations(params?: { intent?: string }): Promise<RawAnnotation[]>
  getViewport(params: { scale: number }): PdfjsViewport
  getTextContent(): Promise<{ items: unknown[] }>
}

interface Storage { setValue(key: string, value: object): void }

function storageOf(doc: ViewerDoc): Storage | null {
  const s = (doc as unknown as { annotationStorage?: Storage }).annotationStorage
  return s && typeof s.setValue === 'function' ? s : null
}

const isComment = (a: RawAnnotation) => a.subtype in MARKUP_SUBTYPES || a.subtype === 'Text'

// ── 1. Hide ─────────────────────────────────────────────────────────────────

const hidden = new WeakMap<ViewerDoc, Map<number, Promise<void>>>()

/**
 * Keep out of a page's picture what the app draws over it: its comments, and
 * the fillable form fields (shown as controls — services/pdfForms). A field
 * stays printable: printing renders with the `print` intent and draws it from
 * the values put in the storage. Awaited before every render of a PDF page
 * (once per page per document); a no-op for anything else.
 */
export function hidePageComments(doc: ViewerDoc, pageNumber: number): Promise<void> {
  const storage = storageOf(doc)
  if (!storage) return Promise.resolve()
  let pages = hidden.get(doc)
  if (!pages) { pages = new Map(); hidden.set(doc, pages) }
  let p = pages.get(pageNumber)
  if (!p) {
    p = (async () => {
      const page = await doc.getPage(pageNumber) as unknown as PdfjsPage
      for (const a of await page.getAnnotations({ intent: 'any' })) {
        if (isComment(a)) storage.setValue(a.id, { noView: true, noPrint: true })
        else if (isFillableWidget(a)) storage.setValue(a.id, { noView: true })
      }
    })().catch(() => { /* drawn as the file has it */ })
    pages.set(pageNumber, p)
  }
  return p
}

/** Render parameters for a page of `doc`, with its comments hidden first. */
export async function commentRenderParams(doc: ViewerDoc, pageNumber: number): Promise<object> {
  if (!storageOf(doc)) return {}
  await hidePageComments(doc, pageNumber)
  return COMMENT_RENDER
}

// ── 2. Read ─────────────────────────────────────────────────────────────────

/** "D:20261017030405+09'00'" → ms; null when it is not a date. */
export function parsePdfDate(s: string | null | undefined): number | null {
  const m = s ? /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?'?/.exec(s) : null
  if (!m) return null
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz, th = '00', tm = '00'] = m
  let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se)
  if (tz === '+' || tz === '-') ms -= (tz === '+' ? 1 : -1) * ((+th * 60 + +tm) * 60000)
  return Number.isFinite(ms) ? ms : null
}

function hexOf(c: ArrayLike<number> | null | undefined, fallback: string): string {
  if (!c || c.length < 3) return fallback
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`.toUpperCase()
}

/** /QuadPoints as one rectangle per marked line, in viewport points. */
function rectsOfQuads(quads: ArrayLike<number>, vp: PdfjsViewport): MarkupRect[] {
  const out: MarkupRect[] = []
  for (let i = 0; i + 7 < quads.length; i += 8) {
    const pts = [0, 2, 4, 6].map(k => vp.convertToViewportPoint(quads[i + k], quads[i + k + 1]))
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
    out.push({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) })
  }
  return mergeLineRects(out)
}

/** A PDF rectangle [x1 y1 x2 y2] in viewport points (pdf.js 6 has no convertToViewportRectangle). */
function rectOf(r: ArrayLike<number>, vp: PdfjsViewport): MarkupRect {
  const [x1, y1] = vp.convertToViewportPoint(r[0], r[1])
  const [x2, y2] = vp.convertToViewportPoint(r[2], r[3])
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }
}

interface TextItem { str: string; transform: number[]; width: number; height: number }

/** Part of a word that spaces delimit — not Chinese or Japanese, which have none. */
const inWord = (c: string) => /[\p{L}\p{N}]/u.test(c) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(c)

/**
 * The text under some marked lines, from the page's text items. An item that
 * runs past the mark (a whole line, half of it highlighted) contributes the
 * share of its characters the mark covers.
 */
export function textUnder(rects: MarkupRect[], items: TextItem[], vp: PdfjsViewport): string {
  const parts: string[] = []
  for (const it of items) {
    if (!it.str) continue
    const [e, f] = [it.transform[4], it.transform[5]]
    const box = rectOf([e, f, e + it.width, f + (it.height || Math.hypot(it.transform[2], it.transform[3]))], vp)
    const horizontal = box.width >= box.height || it.str.length === 1
    for (const r of rects) {
      const ox = Math.min(box.x + box.width, r.x + r.width) - Math.max(box.x, r.x)
      const oy = Math.min(box.y + box.height, r.y + r.height) - Math.max(box.y, r.y)
      if (ox <= 0 || oy <= 0) continue
      if (horizontal) {
        if (oy < Math.min(box.height, r.height) * 0.5) continue
        const n = it.str.length
        const from = Math.max(0, Math.floor(((Math.max(box.x, r.x) - box.x) / (box.width || 1)) * n + 0.3))
        const to = Math.min(n, Math.ceil(((Math.min(box.x + box.width, r.x + r.width) - box.x) / (box.width || 1)) * n - 0.3))
        // The share is an estimate (glyphs are not equally wide), and a mark
        // is made over whole words: widen to the words it touches.
        let a = from, b = to
        while (a > 0 && from - a < 20 && inWord(it.str[a - 1])) a--
        while (b < n && b - to < 20 && inWord(it.str[b])) b++
        if (b > a) parts.push(it.str.slice(a, b))
      } else if (ox >= Math.min(box.width, r.width) * 0.5) {
        parts.push(it.str)
      }
      break
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** Identifies one imported comment across reloads of the same document (a page edit renumbers objects). */
function keyOf(a: RawAnnotation, rects: MarkupRect[]): string {
  const r = rects.map(b => `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`).join(';')
  return [a.subtype, r, a.titleObj?.str ?? '', a.creationDate ?? a.modificationDate ?? '', a.contentsObj?.str ?? ''].join('|')
}

export interface ImportedComments {
  comments: OmitId<CommentAnnotation>[]
  /** The objects they came from (pdf.js ids, e.g. "12R"), popups and replies included. */
  refs: string[]
}

/** One page's comments. */
export async function readPageComments(page: PdfjsPage, pageNumber: number): Promise<ImportedComments> {
  // 'any': the display list leaves out hidden annotations, and a review state
  // ("done") is a hidden reply.
  const raw = await page.getAnnotations({ intent: 'any' })
  const vp = page.getViewport({ scale: 1 })
  const refs: string[] = []
  const comments: OmitId<CommentAnnotation>[] = []
  const byId = new Map<string, OmitId<CommentAnnotation>>()
  let items: TextItem[] | null = null

  for (const a of raw) {
    if (!isComment(a) || a.inReplyTo) continue
    if ((a.annotationFlags ?? 0) & HIDDEN) continue
    const created = parsePdfDate(a.creationDate) ?? parsePdfDate(a.modificationDate) ?? 0
    const modified = parsePdfDate(a.modificationDate) ?? undefined
    const common = {
      page: pageNumber, rotation: 0,
      contents: a.contentsObj?.str ?? '', author: a.titleObj?.str ?? '',
      createdAt: created, modifiedAt: modified, replies: [] as CommentReply[],
    }
    let c: OmitId<CommentAnnotation>
    if (a.subtype === 'Text') {
      const r = rectOf(a.rect, vp)
      c = { ...common, type: 'note', x: r.x, y: r.y, width: NOTE_SIZE, height: NOTE_SIZE, color: hexOf(a.color, MARKUP_COLORS.note), importKey: keyOf(a, [r]) }
    } else {
      const type = MARKUP_SUBTYPES[a.subtype]
      const rects = a.quadPoints && a.quadPoints.length >= 8 ? rectsOfQuads(a.quadPoints, vp) : [rectOf(a.rect, vp)]
      if (rects.length === 0) continue
      items ??= ((await page.getTextContent().catch(() => ({ items: [] }))).items as TextItem[]).filter(i => typeof i.str === 'string')
      const b = {
        x: Math.min(...rects.map(r => r.x)), y: Math.min(...rects.map(r => r.y)),
        width: Math.max(...rects.map(r => r.x + r.width)) - Math.min(...rects.map(r => r.x)),
        height: Math.max(...rects.map(r => r.y + r.height)) - Math.min(...rects.map(r => r.y)),
      }
      c = { ...common, ...b, type, rects, color: hexOf(a.color, MARKUP_COLORS[type]), text: textUnder(rects, items, vp), importKey: keyOf(a, rects) }
    }
    comments.push(c)
    byId.set(a.id, c)
    refs.push(a.id)
    if (a.popupRef) refs.push(a.popupRef)
  }

  // Replies and review states, oldest first, onto the comment they answer.
  const answers = raw.filter(a => a.inReplyTo && byId.has(a.inReplyTo))
    .sort((x, y) => (parsePdfDate(x.creationDate ?? x.modificationDate) ?? 0) - (parsePdfDate(y.creationDate ?? y.modificationDate) ?? 0))
  for (const a of answers) {
    const parent = byId.get(a.inReplyTo!)!
    refs.push(a.id)
    if (a.popupRef) refs.push(a.popupRef)
    if (a.stateModel === 'Review' && a.state) {
      parent.done = a.state === 'Completed' || a.state === 'Accepted'
      continue
    }
    if (a.stateModel) continue // "Marked" and the like: not a reply
    parent.replies.push({
      id: a.id,
      author: a.titleObj?.str ?? '',
      contents: a.contentsObj?.str ?? '',
      createdAt: parsePdfDate(a.creationDate) ?? parsePdfDate(a.modificationDate) ?? 0,
    })
  }
  return { comments, refs }
}

/** Every page's comments, a page at a time. */
export async function importComments(doc: ViewerDoc, numPages: number, cancelled: () => boolean = () => false): Promise<ImportedComments | null> {
  if (!storageOf(doc)) return null
  const all: ImportedComments = { comments: [], refs: [] }
  for (let p = 1; p <= numPages; p++) {
    if (cancelled()) return null
    try {
      const page = await doc.getPage(p) as unknown as PdfjsPage
      const got = await readPageComments(page, p)
      all.comments.push(...got.comments)
      all.refs.push(...got.refs)
    } catch { /* a page that cannot be read keeps its comments as drawn */ }
  }
  return all
}

// ── Which comments are as the file has them ─────────────────────────────────
// Imported objects are recorded as they were made; an edit replaces the object
// (annotations are immutable), so "still in the set" means "unchanged".
const pristine = new WeakSet<object>()
export function markPristine(a: object): void { pristine.add(a) }
export function isPristineImport(a: object): boolean { return pristine.has(a) }
