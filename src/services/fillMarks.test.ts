// @vitest-environment node
//
// Fill & Sign items saved into the page: the typed text reads back where it
// was typed (pdf.js getTextContent through the page's viewport, /Rotate
// included), and the marks are drawn.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PDFDocument, degrees } from '@cantoo/pdf-lib'
import { exportPdf } from './pdfExporter'
import { textBox, markShape, FILL_BASELINE } from './fillMarks'
import type { Annotation, FillAnnotation } from '../types/annotation'

const require = createRequire(import.meta.url)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href
const FONT = readFileSync(new URL('../../public/fonts/NotoSansKR-Regular.otf', import.meta.url))

beforeAll(() => {
  vi.stubGlobal('document', { baseURI: 'http://app.test/' })
  vi.stubGlobal('fetch', async () => new Response(FONT))
})
afterAll(() => { vi.unstubAllGlobals() })

async function blank(rotate = 0): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  const p = doc.addPage([400, 300])
  if (rotate) p.setRotation(degrees(rotate))
  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const text = (t: string): FillAnnotation => ({
  id: 't', type: 'fill', mark: 'text', text: t, fontSize: 12, color: '#000000',
  page: 1, x: 50, y: 40, ...textBox(t, 12), rotation: 0,
})

async function textAt(blob: Blob) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
  const page = await doc.getPage(1)
  const vp = page.getViewport({ scale: 1 })
  const items = (await page.getTextContent()).items as { str: string; transform: number[] }[]
  return items.filter(i => i.str.trim()).map(i => ({ str: i.str, at: vp.convertToViewportPoint(i.transform[4], i.transform[5]).map(Math.round) }))
}

describe('Fill & Sign saved into the page', () => {
  it('writes typed text, Korean included, on the baseline where it was typed', async () => {
    const got = await textAt(await exportPdf(await blank(), [text('김철수 2026. 10. 17.')]))
    expect(got.map(g => g.str).join('')).toContain('김철수')
    expect(got[0].at).toEqual([50, Math.round(40 + 12 * FILL_BASELINE)])
  })

  it('keeps it where it was typed on a turned page', async () => {
    const got = await textAt(await exportPdf(await blank(90), [text('Yes')]))
    expect(got[0].at).toEqual([50, Math.round(40 + 12 * FILL_BASELINE)])
  })

  it('draws the marks', async () => {
    const mark = (m: FillAnnotation['mark'], x: number): Annotation =>
      ({ id: m, type: 'fill', mark: m, text: '', fontSize: 0, color: '#000000', page: 1, x, y: 100, width: 14, height: 14, rotation: 0 })
    const blob = await exportPdf(await blank(), [mark('check', 50), mark('cross', 80), mark('dot', 110), mark('line', 140)])
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
    const ops = (await (await doc.getPage(1)).getOperatorList()).fnArray
    // Lines are stroked paths; the dot is a filled one.
    expect(ops.filter(f => f === pdfjs.OPS.stroke || f === pdfjs.OPS.constructPath).length).toBeGreaterThan(0)
  })

  it('has a shape for every mark', () => {
    for (const m of ['check', 'cross', 'dot', 'line'] as const) {
      const s = markShape(m)
      expect(s.lines.length + (s.dot ? 1 : 0)).toBeGreaterThan(0)
    }
  })
})
