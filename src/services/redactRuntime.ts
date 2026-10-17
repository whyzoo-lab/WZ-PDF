// The parts of applying redactions that need the app: drawing a page with
// pdf.js on a canvas, reading its words, and reading the result back to check
// it (services/redact.ts has the rest, and is what the tests drive).

import type { ViewerDoc } from '../types/viewerDoc'
import type { OcrPageResult } from '../types/ocr'
import { applyRedactions, intersects, type PageMarks, type PageWord, type RenderedPage } from './redact'
import { wordsOfPage } from './compareWords'

interface PdfjsPage {
  getViewport(p: { scale: number; rotation?: number }): { width: number; height: number }
  render(p: object): { promise: Promise<void> }
}

/** Largest side of a redacted page's picture, px (Chromium's canvas limit is 16,384). */
const MAX_SIDE = 8000

async function renderPage(doc: ViewerDoc, page: number, scale: number, boxes: { x: number; y: number; width: number; height: number }[]): Promise<RenderedPage> {
  const p = await doc.getPage(page) as unknown as PdfjsPage
  const natural = p.getViewport({ scale: 1, rotation: 0 })
  const s = Math.min(scale, MAX_SIDE / Math.max(natural.width, natural.height))
  const k = s / scale
  const viewport = p.getViewport({ scale: s, rotation: 0 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // Annotations stay annotations (or go, where they touch a mark); only the
  // page's own content is drawn. The print intent paints even while the
  // window is hidden (display rendering waits on animation frames).
  await p.render({ canvas, viewport, intent: 'print', annotationMode: 0 }).promise
  ctx.fillStyle = '#000000'
  // A pixel past each edge, so no anti-aliased fringe of a glyph survives.
  for (const b of boxes) ctx.fillRect(Math.floor(b.x * k) - 1, Math.floor(b.y * k) - 1, Math.ceil(b.width * k) + 2, Math.ceil(b.height * k) + 2)
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.92))
  canvas.width = canvas.height = 0
  if (!blob) throw new Error('could not encode the page')
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'jpeg' }
}

/** How many words of the result still lie under a mark (more than a point into it). */
export async function wordsUnderMarks(doc: ViewerDoc, marks: PageMarks[]): Promise<number> {
  let left = 0
  for (const m of marks) {
    const words = await wordsOfPage(doc, 'pdf', m.page)
    left += words.filter(w => w.rect && m.rects.some(r => intersects(w.rect!, r, -1))).length
  }
  return left
}

async function openPdf(bytes: Uint8Array): Promise<{ doc: ViewerDoc; close: () => void }> {
  const pdfjs = await import('pdfjs-dist')
  const { getPdfWorkerUrl } = await import('./pdfjsWorker')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = getPdfWorkerUrl()
  const base = new URL('./', document.baseURI)
  const task = pdfjs.getDocument({
    data: bytes.slice(), disableFontFace: true,
    cMapUrl: new URL('cmaps/', base).href, cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', base).href,
  })
  return { doc: await task.promise as unknown as ViewerDoc, close: () => { void task.destroy() } }
}

/** Apply the marks to the open PDF (`doc` is it, as the viewer has it open). */
export async function redactDocument(doc: ViewerDoc, bytes: ArrayBuffer, marks: PageMarks[], opts: {
  password?: string; removeHidden?: boolean; ocr?: Map<number, OcrPageResult>
}) {
  return applyRedactions(bytes, marks, {
    password: opts.password,
    removeHidden: opts.removeHidden,
    render: (page, scale, boxes) => renderPage(doc, page, scale, boxes),
    words: async page => (await wordsOfPage(doc, 'pdf', page, opts.ocr))
      .filter((w): w is PageWord & { page: number } => !!w.rect) as PageWord[],
    verify: async (out, m) => {
      const back = await openPdf(out)
      try { return await wordsUnderMarks(back.doc, m) } finally { back.close() }
    },
  })
}
