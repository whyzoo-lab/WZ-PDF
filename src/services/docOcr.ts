/**
 * OCR of a whole document, for the MCP server's `doc_get_text` (through the
 * app's headless `--ocr-json` mode, electron/ocrJob.ts).
 *
 * The recognizer is the one the viewer uses (ocrEngine.ts: PaddleOCR with the
 * Korean model, in onnxruntime-web), so an agent gets what pressing R in the
 * app would recognize. Two kinds of page are recognized:
 *
 * - a page with no text of its own — a scan, a picture, a HWP page that is
 *   one pasted image ('auto' and 'images');
 * - a page that has text *and* pictures ('images' only). The whole page is
 *   recognized and every line that lies over the page's own text is dropped,
 *   so what is left is the text inside the pictures — a chart's labels, a
 *   screenshot, a scanned stamp — and nothing comes out twice.
 *
 * Word, PowerPoint, sheets and mail are not handled here: they have no pages,
 * and the MCP server takes their pictures out of the file itself and sends
 * each one as an image.
 */

import type { ViewerDoc } from '../types/viewerDoc'
import type { OcrWord } from '../types/ocr'
import { detectDocType } from '../utils/detectDocType'
import { lineToWord } from '../utils/ocrCoords'

export type DocOcrMode = 'auto' | 'images'

export interface DocOcrRequest {
  path: string
  /** 1-based pages to look at; all when absent. */
  pages?: number[]
  mode: DocOcrMode
  /** Recognize at most this many pages; the rest are returned as `pending`. */
  maxPages?: number
}

export interface DocOcrPage {
  page: number
  /** The page has text of its own, so `lines` are only what lies outside it. */
  hasText: boolean
  lines: string[]
}

export interface DocOcrResult {
  path: string
  numPages: number
  pages: DocOcrPage[]
  /** Pages that needed recognizing but were over `maxPages`. */
  pending: number[]
  error?: string
}

interface Rect { x: number; y: number; width: number; height: number }

/** Longest side of the picture handed to the recognizer (the viewer's desktop cap). */
const OCR_MAX_DIM = 2400
/** No page is drawn larger than this many pixels per point, however small it is. */
const MAX_SCALE = 4
/** Lines the recognizer is less sure of are mostly noise from photos and icons. */
const MIN_SCORE = 0.5
/** A line lying this much over the page's own text is that text, read again. */
const COVERED = 0.5
export const DEFAULT_MAX_PAGES = 20

function intersection(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** The recognized lines that do not lie over the page's own text. */
export function outsideText(words: readonly OcrWord[], text: readonly Rect[]): OcrWord[] {
  if (text.length === 0) return [...words]
  return words.filter(w => {
    const area = w.width * w.height
    if (area <= 0) return false
    let covered = 0
    for (const r of text) covered += intersection(w, r)
    return covered / area < COVERED
  })
}

/**
 * Recognized boxes in reading order, one string per visual line. Boxes whose
 * vertical centres are within half a line of each other are one line, read
 * left to right — detection order is not reading order.
 */
export function readingLines(words: readonly OcrWord[]): string[] {
  const sorted = [...words].sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2))
  const lines: { centre: number; height: number; parts: OcrWord[] }[] = []
  for (const w of sorted) {
    const centre = w.y + w.height / 2
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.centre - centre) <= Math.min(last.height, w.height) / 2) {
      last.parts.push(w)
      last.height = Math.max(last.height, w.height)
      continue
    }
    lines.push({ centre, height: w.height, parts: [w] })
  }
  return lines
    .map(l => l.parts.sort((a, b) => a.x - b.x).map(p => p.text).join(' ').trim())
    .filter(Boolean)
}

/** Which pages to look at: the requested ones that exist, in order, once each. */
export function pagesToRead(numPages: number, requested?: readonly number[]): number[] {
  const all = Array.from({ length: numPages }, (_, i) => i + 1)
  if (!requested || requested.length === 0) return all
  return [...new Set(requested.filter(n => Number.isInteger(n) && n >= 1 && n <= numPages))].sort((a, b) => a - b)
}

const IMAGE_OPS = [
  'paintImageXObject', 'paintImageXObjectRepeat', 'paintInlineImageXObject', 'paintInlineImageXObjectGroup',
  'paintImageMaskXObject', 'paintImageMaskXObjectGroup', 'paintImageMaskXObjectRepeat',
] as const

interface Opened {
  doc: ViewerDoc
  kind: 'pdf' | 'hwp' | 'image'
  hasImages(page: number): Promise<boolean>
  close(): void
}

async function open(bytes: ArrayBuffer, name: string): Promise<Opened> {
  const kind = detectDocType(name, bytes)
  if (kind === 'pdf') {
    const [{ loadPdfInWindow }, pdfjs] = await Promise.all([import('./printPreview'), import('pdfjs-dist')])
    const task = await loadPdfInWindow(new Uint8Array(bytes))
    const doc = await task.promise
    const ops = new Set<number>(IMAGE_OPS.map(op => (pdfjs.OPS as Record<string, number>)[op]).filter(n => n !== undefined))
    return {
      doc: doc as unknown as ViewerDoc,
      kind,
      async hasImages(n) {
        const page = await doc.getPage(n)
        const list = await page.getOperatorList({ intent: 'print' })
        return list.fnArray.some(fn => ops.has(fn))
      },
      close: () => { void task.destroy() },
    }
  }
  if (kind === 'hwp') {
    const [{ loadHwp }, { createHwpViewerDoc }, { ensureKoreanFonts }] = await Promise.all([
      import('./hwpEngine'), import('./hwpDocAdapter'), import('./hwpFonts'),
    ])
    await ensureKoreanFonts()
    const doc = createHwpViewerDoc(await loadHwp(bytes))
    return { doc, kind, hasImages: async n => doc.pageHasImages?.(n) ?? true, close: () => doc.destroy() }
  }
  if (kind === 'image') {
    const [{ createImageViewerDoc, createImageSetDoc }, { collectionForZip }] = await Promise.all([
      import('./imageDocAdapter'), import('./imageSet'),
    ])
    // A ZIP of pictures (what "save images" writes) is a collection, as in the viewer.
    const doc = /\.zip$/i.test(name)
      ? await createImageSetDoc(await (await collectionForZip(bytes, name)).arrayBuffer())
      : await createImageViewerDoc(bytes, '', name)
    return { doc, kind, hasImages: async () => true, close: () => doc.destroy() }
  }
  throw new Error(`OCR reads PDF, HWP and image files; ${name} is ${kind}`)
}

/** The page's own text, as boxes in viewport points. */
async function textBoxes(opened: Opened, page: number): Promise<Rect[]> {
  if (opened.kind === 'image') return []
  const { wordsOfPage } = await import('./compareWords')
  const words = await wordsOfPage(opened.doc, opened.kind, page)
  return words.flatMap(w => (w.rect ? [w.rect] : []))
}

/** Draw page n on white and recognize it; boxes in viewport points. */
async function recognizePage(doc: ViewerDoc, n: number): Promise<OcrWord[]> {
  const { predict } = await import('./ocrEngine')
  const page = await doc.getPage(n)
  const unit = page.getViewport({ scale: 1 })
  const scale = Math.min(MAX_SCALE, OCR_MAX_DIM / Math.max(unit.width, unit.height, 1))
  const raw = document.createElement('canvas')
  const viewport = page.getViewport({ scale })
  raw.width = Math.ceil(viewport.width)
  raw.height = Math.ceil(viewport.height)
  // 'print': display rendering paces itself with requestAnimationFrame, which
  // never fires in the hidden window this runs in. HWP and pictures ignore it.
  await page.render({ canvas: raw, viewport, intent: 'print' } as Parameters<typeof page.render>[0]).promise
  ;(page as { cleanup?: () => unknown }).cleanup?.()
  // A picture may have capped its raster, and its empty pixels read as black
  // to the recognizer: measure what was drawn, and lay it on white paper.
  const actual = raw.width / unit.width
  const input = document.createElement('canvas')
  input.width = raw.width
  input.height = raw.height
  const ctx = input.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, input.width, input.height)
  ctx.drawImage(raw, 0, 0)
  raw.width = 0
  try {
    const lines = await predict(input)
    return lines
      .filter(l => l.score >= MIN_SCORE)
      .map(l => lineToWord(l, actual))
      .filter(w => w.text.length > 0)
  } finally {
    input.width = 0
  }
}

export async function ocrDocument(bytes: ArrayBuffer, name: string, request: DocOcrRequest): Promise<DocOcrResult> {
  const opened = await open(bytes, name)
  const result: DocOcrResult = { path: request.path, numPages: opened.doc.numPages, pages: [], pending: [] }
  const budget = Math.max(1, Math.floor(request.maxPages ?? DEFAULT_MAX_PAGES))
  try {
    for (const n of pagesToRead(opened.doc.numPages, request.pages)) {
      const text = await textBoxes(opened, n)
      const hasText = text.length > 0
      const wanted = !hasText || (request.mode === 'images' && await opened.hasImages(n))
      if (!wanted) continue
      if (result.pages.length >= budget) { result.pending.push(n); continue }
      const words = await recognizePage(opened.doc, n)
      result.pages.push({ page: n, hasText, lines: readingLines(outsideText(words, text)) })
    }
    return result
  } finally {
    opened.close()
  }
}
