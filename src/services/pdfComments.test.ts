// @vitest-environment node
//
// Comments are saved as annotations a reader lists: read back through pdf.js
// getAnnotations — what Edge and Firefox use — not inferred from the writer.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PDFDocument, degrees } from '@cantoo/pdf-lib'
import { exportPdf } from './pdfExporter'
import { pdfDate } from './pdfComments'
import type { Annotation, NoteAnnotation, TextMarkupAnnotation } from '../types/annotation'

const require = createRequire(import.meta.url)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href

/** Page 1 plain; page 2 turned 90° with a CropBox that does not start at 0,0. */
async function source(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  doc.addPage([400, 300])
  const p2 = doc.addPage([500, 400])
  p2.setCropBox(50, 30, 400, 300)
  p2.setRotation(degrees(90))
  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const base = { rotation: 0, author: '김철수', createdAt: Date.UTC(2026, 9, 17, 3, 4, 5), replies: [] }

const highlight = (page: number): TextMarkupAnnotation => ({
  ...base, id: `h${page}`, type: 'highlight', page, color: '#FFE14D', text: '계약 기간',
  contents: '여기 확인 부탁', x: 40, y: 50, width: 120, height: 34,
  rects: [{ x: 40, y: 50, width: 120, height: 14 }, { x: 40, y: 70, width: 60, height: 14 }],
})

async function annotationsOf(bytes: Blob, page: number) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await bytes.arrayBuffer()) }).promise
  const p = await doc.getPage(page)
  return { anns: await p.getAnnotations(), viewport: p.getViewport({ scale: 1 }) }
}

/** /QuadPoints back in the viewport the reader sees, as rects. */
function quadRects(quad: ArrayLike<number>, viewport: { convertToViewportPoint(x: number, y: number): number[] }) {
  const out = []
  for (let i = 0; i < quad.length; i += 8) {
    const pts = [0, 2, 4, 6].map(k => viewport.convertToViewportPoint(quad[i + k], quad[i + k + 1]))
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
    out.push({
      x: Math.round(Math.min(...xs)), y: Math.round(Math.min(...ys)),
      width: Math.round(Math.max(...xs) - Math.min(...xs)), height: Math.round(Math.max(...ys) - Math.min(...ys)),
    })
  }
  return out
}

describe('comments saved as PDF annotations', () => {
  it('writes a highlight with its comment, author and lines', async () => {
    const blob = await exportPdf(await source(), [highlight(1)])
    const { anns, viewport } = await annotationsOf(blob, 1)
    const h = anns.find(a => a.subtype === 'Highlight')!
    expect(h).toBeTruthy()
    expect(h.contentsObj.str).toBe('여기 확인 부탁')
    expect(h.titleObj.str).toBe('김철수')
    expect(h.hasAppearance).toBe(true)
    expect(quadRects(h.quadPoints, viewport)).toEqual(highlight(1).rects)
    // A popup goes with it, as Acrobat writes one.
    expect(anns.some(a => a.subtype === 'Popup')).toBe(true)
  })

  it('lands where the viewer showed it on a rotated, cropped page', async () => {
    const blob = await exportPdf(await source(), [highlight(2)])
    const { anns, viewport } = await annotationsOf(blob, 2)
    expect(viewport.width).toBe(300) // turned: the crop's height across
    const h = anns.find(a => a.subtype === 'Highlight')!
    expect(quadRects(h.quadPoints, viewport)).toEqual(highlight(2).rects)
  })

  it('writes underline and strike-through as their own kinds', async () => {
    const anns: Annotation[] = [
      { ...highlight(1), id: 'u', type: 'underline' },
      { ...highlight(1), id: 's', type: 'strikeout' },
    ]
    const { anns: back } = await annotationsOf(await exportPdf(await source(), anns), 1)
    expect(back.map(a => a.subtype).filter(s => s !== 'Popup').sort()).toEqual(['StrikeOut', 'Underline'])
  })

  it('writes a note with its replies and done state as a thread', async () => {
    const note: NoteAnnotation = {
      ...base, id: 'n1', type: 'note', page: 1, x: 100, y: 100, width: 20, height: 20, color: '#FFC21A',
      contents: '첫 메모', done: true,
      replies: [{ id: 'r1', author: '이영희', contents: '반영했어요', createdAt: base.createdAt + 1000 }],
    }
    const { anns, viewport } = await annotationsOf(await exportPdf(await source(), [note]), 1)
    const texts = anns.filter(a => a.subtype === 'Text')
    const parent = texts.find(a => !a.inReplyTo)!
    expect(parent.contentsObj.str).toBe('첫 메모')
    const [x1, y1] = viewport.convertToViewportPoint(parent.rect[0], parent.rect[3])
    expect([Math.round(x1), Math.round(y1)]).toEqual([100, 100])
    const replies = texts.filter(a => a.inReplyTo === parent.id)
    expect(replies.map(r => r.contentsObj.str)).toContain('반영했어요')
    expect(replies.find(r => r.titleObj.str === '이영희')).toBeTruthy()
    // The done state is a reply too, hidden from the page.
    expect(replies).toHaveLength(2)
  })

  it('is drawn by a reader: the appearance is painted, replies are not', async () => {
    const note: NoteAnnotation = {
      ...base, id: 'n1', type: 'note', page: 1, x: 100, y: 100, width: 20, height: 20, color: '#FFC21A',
      contents: '메모', done: true, replies: [{ id: 'r1', author: 'B', contents: '답', createdAt: 0 }],
    }
    const blob = await exportPdf(await source(), [highlight(1), note])
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
    const ops = await (await doc.getPage(1)).getOperatorList({ annotationMode: pdfjs.AnnotationMode.ENABLE })
    const begins = ops.fnArray.filter(f => f === pdfjs.OPS.beginAnnotation).length
    // The highlight and the note icon. The reply has an empty appearance and
    // the status reply is hidden, so neither adds a mark of its own.
    expect(begins).toBeGreaterThanOrEqual(2)
    expect(ops.fnArray).toContain(pdfjs.OPS.setGState)
  })

  it('keeps annotations the file already had', async () => {
    const first = await exportPdf(await source(), [highlight(1)])
    const again = await exportPdf(await first.arrayBuffer(), [{ ...highlight(1), id: 'h2', contents: '두 번째' }])
    const { anns } = await annotationsOf(again, 1)
    expect(anns.filter(a => a.subtype === 'Highlight')).toHaveLength(2)
  })
})

describe('pdfDate', () => {
  it('is a PDF date in UTC', () => {
    expect(pdfDate(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('D:20260102030405Z')
  })
})
