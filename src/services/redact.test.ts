// @vitest-environment node
//
// Redaction removes: read the result back through pdf.js the way a reader
// copies or searches text, and the words under a mark are not in the file;
// the rest of the page still is.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PDFDict, PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib'
import { applyRedactions, findInWords, literal, REDACT_PATTERNS, RedactionNotVerified, type PageWord } from './redact'
import { wordsOfPage } from './compareWords'
import { wordsUnderMarks } from './redactRuntime'
import type { ViewerDoc } from '../types/viewerDoc'
import { exportPdf } from './pdfExporter'

const require = createRequire(import.meta.url)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href
const FONT = readFileSync(new URL('../../public/fonts/NotoSansKR-Regular.otf', import.meta.url))
// A 1x1 white PNG stands in for the page picture (Node has no canvas).
const WHITE = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'), c => c.charCodeAt(0))

beforeAll(() => {
  vi.stubGlobal('document', { baseURI: 'http://app.test/' })
  vi.stubGlobal('fetch', async () => new Response(FONT))
})
afterAll(() => { vi.unstubAllGlobals() })

async function source(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  doc.setTitle('Secret plan')
  doc.setAuthor('Kim')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([400, 300])
  page.drawText('Name Kim Chulsoo phone 010-1234-5678', { x: 20, y: 250, size: 12, font })
  page.drawText('The rest of the page stays readable', { x: 20, y: 200, size: 12, font })
  // A link over the phone number, and one elsewhere.
  for (const rect of [[200, 245, 330, 262], [20, 20, 80, 40]]) {
    page.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, A: { S: 'URI', URI: doc.context.obj('http://example.com') } })))
  }
  await doc.attach(new TextEncoder().encode('hidden'), 'notes.txt', { mimeType: 'text/plain' })
  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function open(data: Uint8Array | ArrayBuffer) {
  return pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise as unknown as Promise<ViewerDoc & { numPages: number }>
}

async function pageWords(doc: ViewerDoc, page = 1): Promise<PageWord[]> {
  return (await wordsOfPage(doc, 'pdf', page)).filter(w => w.rect) as PageWord[]
}

async function redact(bytes: ArrayBuffer, marksFrom: (words: PageWord[]) => { x: number; y: number; width: number; height: number }[], extra: object = {}) {
  const doc = await open(bytes)
  const words = await pageWords(doc)
  const marks = [{ page: 1, rects: marksFrom(words) }]
  return applyRedactions(bytes, marks, {
    render: async () => ({ bytes: WHITE, type: 'png' }),
    words: async () => words,
    verify: async (out, m) => wordsUnderMarks(await open(out), m),
    ...extra,
  })
}

describe('applying redactions', () => {
  it('takes the marked words out of the file and keeps the rest searchable', async () => {
    const { bytes, report } = await redact(await source(), words => findInWords(1, words, REDACT_PATTERNS).flatMap(f => f.rects))
    const back = await open(bytes)
    const text = (await pageWords(back)).map(w => w.text).join(' ')
    expect(text).not.toContain('010')
    expect(text).not.toContain('5678')
    expect(text).toContain('Chulsoo')
    expect(text).toContain('readable')
    expect(report.wordsRemoved).toBeGreaterThan(0)
  })

  it('removes annotations that touch a mark, keeps the others', async () => {
    const { bytes, report } = await redact(await source(), words => findInWords(1, words, [REDACT_PATTERNS[1]]).flatMap(f => f.rects))
    const back = await open(bytes)
    const links = await (await back.getPage(1) as unknown as { getAnnotations(): Promise<{ rect: number[] }[]> }).getAnnotations()
    expect(links.map(l => Math.round(l.rect[0]))).toEqual([20])
    expect(report.annotationsRemoved).toBe(1)
  })

  it('removes the hidden information when asked', async () => {
    const { bytes, report } = await redact(await source(), words => [words[0].rect], { removeHidden: true })
    const back = await open(bytes) as unknown as { getMetadata(): Promise<{ info: Record<string, unknown> }>; getAttachments(): Promise<unknown> }
    const { info } = await back.getMetadata()
    expect(info.Title).toBeUndefined()
    expect(info.Author).toBeUndefined()
    expect(await back.getAttachments()).toBeNull()
    expect(report.hiddenRemoved).toEqual(expect.arrayContaining(['properties', 'attachments']))
  })

  it('keeps nothing of the old page content', async () => {
    const { bytes } = await redact(await source(), words => [words[0].rect])
    // The page's own font is not in the file any more; what is left is the
    // picture and the font of the invisible text.
    const back = await PDFDocument.load(bytes)
    const baseFonts = back.context.enumerateIndirectObjects()
      .map(([, o]) => (o instanceof PDFDict ? String(o.get(PDFName.of('BaseFont')) ?? '') : ''))
      .filter(Boolean)
    expect(baseFonts.some(f => f.includes('Helvetica'))).toBe(false)
    expect(baseFonts.length).toBeGreaterThan(0) // the Korean font of the invisible text
    const res = back.getPages()[0].node.Resources()!
    expect(res.lookup(PDFName.of('XObject'), PDFDict).keys().map(k => k.toString())).toEqual(['/WzRedacted'])
  })

  it('fails closed when the result does not verify', async () => {
    await expect(redact(await source(), words => [words[0].rect], { verify: async () => 3 })).rejects.toBeInstanceOf(RedactionNotVerified)
  })
})

describe('finding what to redact', () => {
  const w = (text: string, x: number): PageWord => ({ text, rect: { x, y: 0, width: text.length * 6, height: 10 } })

  it('finds Korean personal information and marks only the matching part of a word', () => {
    const words = [w('주민번호', 0), w('900101-1234567,', 60), w('연락처:010-1234-5678', 160), w('a@b.co.kr', 300)]
    const found = findInWords(1, words, REDACT_PATTERNS)
    expect(found.map(f => [f.pattern, f.text])).toEqual(expect.arrayContaining([
      ['rrn', '900101-1234567'], ['mobile', '010-1234-5678'], ['email', 'a@b.co.kr'],
    ]))
    const mobile = found.find(f => f.pattern === 'mobile')!
    expect(mobile.rects[0].x).toBe(160 + 4 * 6) // after "연락처:"
  })

  it('checks card numbers', () => {
    expect(findInWords(1, [w('4111-1111-1111-1111', 0)], REDACT_PATTERNS).map(f => f.pattern)).toContain('card')
    expect(findInWords(1, [w('1234-5678-9012-3456', 0)], REDACT_PATTERNS).map(f => f.pattern)).not.toContain('card')
  })

  it('finds typed text across words, ignoring case', () => {
    const found = findInWords(1, [w('Project', 0), w('Falcon', 50)], [{ id: 'text', re: literal('project falcon') }])
    expect(found[0].rects).toHaveLength(2)
  })
})

describe('saving with marks pending', () => {
  it('is refused: the words under a mark would still be in the file', async () => {
    const mark = { id: 'r', type: 'redact' as const, page: 1, x: 0, y: 0, width: 10, height: 10, rotation: 0, rects: [{ x: 0, y: 0, width: 10, height: 10 }], text: '' }
    await expect(exportPdf(await source(), [mark])).rejects.toThrow()
  })
})
