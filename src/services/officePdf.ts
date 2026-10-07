/**
 * Word, PowerPoint and spreadsheets → PDF.
 *
 * These are HTML on screen, and the best PDF of HTML is the one Chromium
 * prints: text stays text (selectable, searchable, sharp at any zoom),
 * pictures keep their resolution, and the layout is the one already on screen.
 * Rasterising, as the page-based exporters must, would throw all of that away.
 *
 * So each view describes a `PdfJob` — its document as print-ready DOM plus the
 * @page rules (paper size, margins) it needs — and this module puts it in
 * `#wz-print-root`, the same mechanism printing uses (the print stylesheet hides
 * the app shell), and has the main process print the page to PDF. A job can come
 * in pieces, printed one at a time and joined: a 215,897-row sheet is far too
 * large to be one DOM.
 *
 * Desktop app only; the web build has no printToPDF and prints instead, where
 * the browser's own dialog offers "Save as PDF".
 */

import { copyCanvases } from './htmlPrint'

export interface PdfJob {
  /** @page rules and print-only overrides for this document. */
  css: string
  /** How many pieces the document is printed in (1 for almost all). */
  pieces: number
  /** Build piece `index` — DOM that is put in the print root as is. */
  piece(index: number): HTMLElement | Promise<HTMLElement>
  /**
   * Reflowing text (Markdown, mail): printed under the print stylesheet's
   * reflowing-document rules, as printing it from the app does.
   */
  flow?: boolean
}

/** Marks the body while a job is printing, so print CSS can target it. */
export const OFFICE_PDF_ATTR = 'data-wz-office-pdf'

const IMAGE_DEADLINE_MS = 3000

async function decodeImages(root: HTMLElement): Promise<void> {
  await Promise.all(Array.from(root.querySelectorAll('img')).map(img => new Promise<void>(resolve => {
    const done = () => resolve()
    try { img.decode().then(done, done) } catch { done() }
    setTimeout(done, IMAGE_DEADLINE_MS)
  })))
}

/**
 * One print layout at a time. Two in the page together would each be printed
 * by the other's printToPDF — the first PDF of a deck came out with every
 * slide twice, and the next document's PDF started with the deck's slides.
 */
let queue: Promise<unknown> = Promise.resolve()

/** Lay `content` out for print, run `print`, and put the app back. */
function withPrintLayout<T>(content: HTMLElement, job: PdfJob, print: () => Promise<T>): Promise<T> {
  const run = queue.then(() => layoutAndPrint(content, job, print))
  queue = run.catch(() => undefined)
  return run
}

async function layoutAndPrint<T>(content: HTMLElement, job: PdfJob, print: () => Promise<T>): Promise<T> {
  const root = document.createElement('div')
  root.id = 'wz-print-root'
  root.appendChild(content)
  const style = document.createElement('style')
  style.textContent = job.css
  try {
    document.head.appendChild(style)
    document.body.appendChild(root)
    document.body.setAttribute('data-wz-printing', '')
    document.body.setAttribute(OFFICE_PDF_ATTR, '')
    if (job.flow) document.body.setAttribute('data-wz-flow-printing', '')
    await decodeImages(root)
    return await print()
  } finally {
    document.body.removeAttribute('data-wz-printing')
    document.body.removeAttribute(OFFICE_PDF_ATTR)
    document.body.removeAttribute('data-wz-flow-printing')
    root.remove()
    style.remove()
  }
}

/** Whether this build can write a PDF directly (the desktop app). */
export function canSaveOfficePdf(): boolean {
  return typeof window.electronAPI?.printToPdf === 'function'
}

/**
 * Print a job to PDF bytes. Pieces are printed in turn and joined; progress
 * is reported as a fraction after each.
 */
export async function officeJobToPdf(job: PdfJob, onProgress?: (fraction: number) => void): Promise<Uint8Array> {
  const printToPdf = window.electronAPI?.printToPdf
  if (!printToPdf) throw new Error('PDF export needs the desktop app')
  const parts: Uint8Array[] = []
  for (let i = 0; i < job.pieces; i++) {
    const content = await job.piece(i)
    parts.push(new Uint8Array(await withPrintLayout(content, job, printToPdf)))
    onProgress?.((i + 1) / job.pieces)
  }
  return mergePdfs(parts)
}

/** Join PDFs page for page, in order. One part is returned as it is. */
export async function mergePdfs(parts: Uint8Array[]): Promise<Uint8Array> {
  if (parts.length === 1) return parts[0]
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const out = await PDFDocument.create()
  for (const part of parts) {
    const doc = await PDFDocument.load(part)
    for (const page of await out.copyPages(doc, doc.getPageIndices())) out.addPage(page)
  }
  return out.save()
}

/**
 * The web build's fallback: the same layout, sent to the browser's print
 * dialog, whose destinations include "Save as PDF". Only a one-piece job.
 */
export async function printOfficeJob(job: PdfJob): Promise<void> {
  const content = await job.piece(0)
  await withPrintLayout(content, job, async () => { window.print() })
}

/** A deep copy of `el` with its canvases' pixels (charts) carried over. */
export function cloneForPrint<T extends HTMLElement>(el: T): T {
  const copy = el.cloneNode(true) as T
  copyCanvases(el, copy)
  return copy
}
