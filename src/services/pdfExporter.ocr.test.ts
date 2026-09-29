// @vitest-environment node
//
// Saving keeps what OCR recognized: the text a reader selects, copies and
// searches in the saved file is read back the way a reader gets it — pdfjs
// getTextContent — not inferred from which drawing calls were made.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PDFDocument, PDFName, PDFRawStream, degrees } from '@cantoo/pdf-lib'
import { exportPdf } from './pdfExporter'
import { placeOcrWords } from './ocrTextLayer'
import type { OcrPageResult } from '../types/ocr'
import type { ViewerDoc } from '../types/viewerDoc'

const require = createRequire(import.meta.url)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

/**
 * pdfjs warnings printed while `work` runs. Captured with a spy at that moment:
 * vitest swaps the console per test, so a wrapper installed at module load
 * never sees them — which is how an earlier version of this check passed
 * against a broken font.
 */
async function pdfjsWarnings(work: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { if (String(a[0]).startsWith('Warning')) seen.push(String(a[0])) })
  const warn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { if (String(a[0]).startsWith('Warning')) seen.push(String(a[0])) })
  try { await work() } finally { log.mockRestore(); warn.mockRestore() }
  return seen
}
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href

const FONT = readFileSync(new URL('../../public/fonts/NotoSansKR-Regular.otf', import.meta.url))

beforeAll(() => {
  // The exporter fetches the bundled Korean font relative to the page.
  vi.stubGlobal('document', { baseURI: 'http://app.test/' })
  vi.stubGlobal('fetch', async () => new Response(FONT))
})
afterAll(() => { vi.unstubAllGlobals() })

/** A two-page "scan": nothing but blank pages, the second turned 90°. */
async function scannedPdf(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  doc.addPage([400, 200])
  doc.addPage([400, 200]).setRotation(degrees(90))
  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function open(bytes: ArrayBuffer | Uint8Array) {
  return pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise
}

async function textOf(doc: Awaited<ReturnType<typeof open>>, n: number) {
  const content = await (await doc.getPage(n)).getTextContent()
  return content.items.map(it => ('str' in it ? it.str : '')).join('')
}

const ocr = (page: number, text: string): OcrPageResult => ({
  page, status: 'done', durationMs: 1,
  words: [{ text, score: 0.9, x: 40, y: 30, width: 120, height: 16, rotation: 0 }],
})

describe('saving a document that was recognized with OCR', () => {
  it('keeps the recognized text, readable where the reader saw it', async () => {
    const source = await scannedPdf()
    const viewer = await open(source)
    const layer = await placeOcrWords(viewer as unknown as ViewerDoc, new Map([
      [1, ocr(1, '스캔한 계약서')],
      [2, ocr(2, 'Rotated page')],
    ]))

    const saved = await open(await (await exportPdf(source, [], {}, layer)).arrayBuffer())
    expect(await textOf(saved, 1)).toContain('스캔한 계약서')
    expect(await textOf(saved, 2)).toContain('Rotated page')

    // Where the text landed, in the page as displayed: the box OCR measured.
    for (const n of [1, 2]) {
      const page = await saved.getPage(n)
      const vp = page.getViewport({ scale: 1 })
      const item = (await page.getTextContent()).items.find(it => 'str' in it && it.str.trim()) as { transform: number[] }
      const [vx, vy] = vp.convertToViewportPoint(item.transform[4], item.transform[5])
      expect(vx).toBeCloseTo(40, 0)
      expect(vy).toBeCloseTo(30 + 16 * 0.82, 0)
    }
  })

  it('saves exactly as before when nothing was recognized', async () => {
    const source = await scannedPdf()
    const saved = await open(await (await exportPdf(source, [])).arrayBuffer())
    expect(await textOf(saved, 1)).toBe('')
  })
})

describe('Korean text in a saved PDF', () => {
  // Every subsetted font failed at save() under @cantoo/pdf-lib (see
  // services/fontkit.ts), so any save carrying Korean text threw.
  it('saves a Korean watermark', async () => {
    const source = await scannedPdf()
    const blob = await exportPdf(source, [{
      id: 'w', type: 'watermark', page: 1, allPages: false, x: 0, y: 0, width: 0, height: 0,
      text: '대외비 계약서', fontSize: 40, color: '#ff0000', opacity: 0.3, rotation: 0,
    } as never])
    const data = await blob.arrayBuffer()
    let text = ''
    // The whole read: pdfjs parses a font once, on first use, and extracting
    // the text is already a use — checking only the drawing missed it.
    const warnings = await pdfjsWarnings(async () => {
      const saved = await open(data)
      text = await textOf(saved, 1)
      await (await saved.getPage(1)).getOperatorList()
    })
    expect(text).toContain('대외비')

    // …and draws it. @pdf-lib/fontkit's subsetter wrote a font program with
    // broken subroutines: the text was still extractable, but "계약서" painted
    // as blank space. pdfjs says so while parsing it.
    expect(warnings).toEqual([])
  })

  it('embeds the Korean font once when both a watermark and OCR text need it', async () => {
    const source = await scannedPdf()
    const viewer = await open(source)
    const layer = await placeOcrWords(viewer as unknown as ViewerDoc, new Map([[1, ocr(1, '스캔')]]))
    const blob = await exportPdf(source, [{
      id: 'w', type: 'watermark', page: 1, allPages: false, x: 0, y: 0, width: 0, height: 0,
      text: '대외비', fontSize: 40, color: '#ff0000', opacity: 0.3, rotation: 0,
    } as never], {}, layer)
    const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()))
    const fontPrograms = doc.context.enumerateIndirectObjects()
      .filter(([, obj]) => obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype'))?.toString() === '/CIDFontType0C')
    expect(fontPrograms).toHaveLength(1)
  })
})
