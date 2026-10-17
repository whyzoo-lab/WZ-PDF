// The words of a document, for comparing (services/textCompare): in reading
// order, each with its page and box in viewport points — the space marks are
// drawn in. PDF text comes from pdf.js, HWP from rhwp's runs, a scanned page
// from what OCR recognized; another file picked to compare against may also
// be a Word or PowerPoint file or Markdown, read as text without boxes.

import type { ViewerDoc, DocKind } from '../types/viewerDoc'
import type { OcrPageResult } from '../types/ocr'
import type { Word } from './textCompare'

interface TextItem { str: string; transform: number[]; width: number; height: number }

/**
 * A run of text split into its words, each given its share of the run's
 * width by character count — glyph widths are not known here, and the share
 * is close enough to mark a word.
 */
export function splitRun(text: string, page: number, box: { x: number; y: number; width: number; height: number } | undefined): Word[] {
  const out: Word[] = []
  const n = text.length
  for (const m of text.matchAll(/\S+/g)) {
    const at = m.index ?? 0
    out.push({
      text: m[0], page,
      rect: box && n > 0 ? { x: box.x + (box.width * at) / n, y: box.y, width: (box.width * m[0].length) / n, height: box.height } : undefined,
    })
  }
  return out
}

interface PdfjsPage {
  getTextContent(): Promise<{ items: unknown[] }>
  getViewport(params: { scale: number }): { convertToViewportPoint(x: number, y: number): number[] }
}

async function pdfPageWords(page: PdfjsPage, pageNumber: number): Promise<Word[]> {
  const vp = page.getViewport({ scale: 1 })
  const items = (await page.getTextContent()).items as TextItem[]
  const out: Word[] = []
  for (const it of items) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue
    const [a, b, c, d, e, f] = it.transform
    const h = it.height || Math.hypot(c, d)
    // The item's run along its baseline, up by its height: its box on the page as shown.
    const ux = Math.hypot(a, b) ? a / Math.hypot(a, b) : 1, uy = Math.hypot(a, b) ? b / Math.hypot(a, b) : 0
    const corners = [[e, f], [e + ux * it.width, f + uy * it.width], [e - uy * h, f + ux * h], [e + ux * it.width - uy * h, f + uy * it.width + ux * h]]
      .map(([x, y]) => vp.convertToViewportPoint(x, y))
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1])
    const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
    // A vertical run (a turned page) is split along its height instead.
    if (box.height > box.width * 1.5 && it.str.length > 1) {
      const turned = splitRun(it.str, pageNumber, { x: box.y, y: box.x, width: box.height, height: box.width })
      out.push(...turned.map(w => ({ ...w, rect: w.rect && { x: w.rect.y, y: w.rect.x, width: w.rect.height, height: w.rect.width } })))
    } else out.push(...splitRun(it.str, pageNumber, box))
  }
  return out
}

/** One page's words. A page with no text of its own uses OCR's. */
export async function wordsOfPage(doc: ViewerDoc, kind: DocKind, p: number, ocr?: Map<number, OcrPageResult>): Promise<Word[]> {
  let words: Word[] = []
  try {
    if (kind === 'pdf') words = await pdfPageWords(await doc.getPage(p) as unknown as PdfjsPage, p)
    else if (doc.getPageText) {
      for (const r of await doc.getPageText(p)) words.push(...splitRun(r.text, p, r))
    }
  } catch { /* a page that cannot be read compares as empty */ }
  if (words.length === 0) {
    const rec = ocr?.get(p)
    if (rec?.status === 'done') for (const w of rec.words) words.push(...splitRun(w.text, p, w))
  }
  return words
}

/** The open document's words. */
export async function wordsOfDocument(doc: ViewerDoc, kind: DocKind, numPages: number, ocr?: Map<number, OcrPageResult>, cancelled: () => boolean = () => false): Promise<Word[]> {
  const out: Word[] = []
  for (let p = 1; p <= numPages; p++) {
    if (cancelled()) return out
    out.push(...await wordsOfPage(doc, kind, p, ocr))
  }
  return out
}

/** A file picked to compare against: its words, and whether they have boxes. */
export async function wordsOfFile(file: File): Promise<{ words: Word[]; pages: number }> {
  const bytes = await file.arrayBuffer()
  const { detectDocType } = await import('../utils/detectDocType')
  const type = detectDocType(file.name, bytes)
  if (type === 'pdf') {
    const pdfjs = await import('pdfjs-dist')
    const { getPdfWorkerUrl } = await import('./pdfjsWorker')
    if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = getPdfWorkerUrl()
    const base = new URL('./', document.baseURI)
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes), disableFontFace: true,
      cMapUrl: new URL('cmaps/', base).href, cMapPacked: true,
      standardFontDataUrl: new URL('standard_fonts/', base).href,
    })
    try {
      const doc = await task.promise
      return { words: await wordsOfDocument(doc as unknown as ViewerDoc, 'pdf', doc.numPages), pages: doc.numPages }
    } finally {
      void task.destroy()
    }
  }
  if (type === 'hwp') {
    const { loadHwp } = await import('./hwpEngine')
    const { createHwpViewerDoc } = await import('./hwpDocAdapter')
    const doc = createHwpViewerDoc(await loadHwp(bytes))
    try {
      return { words: await wordsOfDocument(doc, 'hwp', doc.numPages), pages: doc.numPages }
    } finally {
      void doc.destroy?.()
    }
  }
  if (type === 'docx' || type === 'pptx') {
    const { default: JSZip } = await import('jszip')
    const { ooxmlText, zipText, pptxText } = await import('./ooxmlText')
    if (type === 'pptx') {
      const slides = await pptxText(bytes)
      return { words: slides.flatMap(s => splitRun(s.text, s.number, undefined)), pages: slides.length }
    }
    const xml = await zipText(await JSZip.loadAsync(bytes), 'word/document.xml')
    return { words: splitRun(ooxmlText(xml ?? '', 'w'), 1, undefined), pages: 1 }
  }
  if (type === 'md' || /\.txt$/i.test(file.name)) {
    return { words: splitRun(new TextDecoder().decode(bytes), 1, undefined), pages: 1 }
  }
  throw new Error('unsupported')
}
