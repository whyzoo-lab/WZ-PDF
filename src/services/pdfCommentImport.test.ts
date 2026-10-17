// @vitest-environment node
//
// A file's own comments come back as editable comments: written by the
// exporter (or any reader), read back through pdf.js the way the app opens a
// file, hidden from the page picture, and replaced — not duplicated — on save.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib'
import { exportPdf } from './pdfExporter'
import { hidePageComments, importComments, parsePdfDate, textUnder, COMMENT_RENDER } from './pdfCommentImport'
import type { Annotation, NoteAnnotation, TextMarkupAnnotation } from '../types/annotation'
import type { ViewerDoc } from '../types/viewerDoc'

const require = createRequire(import.meta.url)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href

async function source(rotate = 0): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([400, 300])
  page.drawText('The contract term is one year', { x: 40, y: 250, size: 14, font })
  if (rotate) page.setRotation(degrees(rotate))
  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const base = { rotation: 0, author: '김철수', createdAt: Date.UTC(2026, 9, 17, 3, 4, 5), replies: [] }
const highlight: TextMarkupAnnotation = {
  ...base, id: 'h', type: 'highlight', page: 1, color: '#FFE14D', text: '', contents: '기간 확인',
  // "contract term" on the line drawn at y = 250 (top-down: 300 - 250 - ~3 descent … ~14 high)
  x: 66, y: 36, width: 94, height: 18, rects: [{ x: 66, y: 36, width: 94, height: 18 }],
}
const note: NoteAnnotation = {
  ...base, id: 'n', type: 'note', page: 1, x: 300, y: 120, width: 20, height: 20, color: '#FFC21A',
  contents: '메모', done: true, replies: [{ id: 'r', author: '이영희', contents: '반영함', createdAt: base.createdAt + 5000 }],
}

async function open(blob: Blob | ArrayBuffer) {
  const data = new Uint8Array(blob instanceof Blob ? await blob.arrayBuffer() : blob.slice(0))
  return pdfjs.getDocument({ data }).promise
}

describe('importing a file’s comments', () => {
  it('reads back what was saved: lines, words, thread, status', async () => {
    const doc = await open(await exportPdf(await source(), [highlight, note]))
    const got = (await importComments(doc as unknown as ViewerDoc, doc.numPages))!
    const h = got.comments.find(c => c.type === 'highlight') as TextMarkupAnnotation
    const n = got.comments.find(c => c.type === 'note') as NoteAnnotation
    expect(h.contents).toBe('기간 확인')
    expect(h.author).toBe('김철수')
    expect(h.createdAt).toBe(base.createdAt)
    expect(h.rects.map(r => [r.x, r.y, r.width, r.height].map(Math.round))).toEqual([[66, 36, 94, 18]])
    expect(h.text).toContain('contract')
    expect(h.importKey).toBeTruthy()
    expect(n.contents).toBe('메모')
    expect([Math.round(n.x), Math.round(n.y)]).toEqual([300, 120])
    expect(n.done).toBe(true)
    expect(n.replies.map(r => [r.author, r.contents])).toEqual([['이영희', '반영함']])
    // Each comment, its popup, the reply and the status reply.
    expect(got.refs.length).toBeGreaterThanOrEqual(6)
  })

  it('lands where it was on a page with /Rotate', async () => {
    const doc = await open(await exportPdf(await source(90), [highlight]))
    const got = (await importComments(doc as unknown as ViewerDoc, doc.numPages))!
    const h = got.comments[0] as TextMarkupAnnotation
    expect(h.rects.map(r => [r.x, r.y, r.width, r.height].map(Math.round))).toEqual([[66, 36, 94, 18]])
  })

  it('keeps them out of the page picture once hidden', async () => {
    const doc = await open(await exportPdf(await source(), [highlight, note]))
    const count = async () => {
      const ops = await (await doc.getPage(1)).getOperatorList({ annotationMode: COMMENT_RENDER.annotationMode })
      return ops.fnArray.filter(f => f === pdfjs.OPS.beginAnnotation).length
    }
    expect(await count()).toBeGreaterThan(0)
    await hidePageComments(doc as unknown as ViewerDoc, 1)
    expect(await count()).toBe(0)
  })

  it('replaces them on save instead of adding a second copy', async () => {
    const first = await exportPdf(await source(), [highlight, note])
    const doc = await open(first)
    const got = (await importComments(doc as unknown as ViewerDoc, doc.numPages))!
    // The reader edits one comment and deletes the other.
    const edited = { ...(got.comments.find(c => c.type === 'highlight') as TextMarkupAnnotation), id: 'x', contents: '고침' }
    const again = await exportPdf(await first.arrayBuffer(), [edited as Annotation], { replacedAnnotations: new Set(got.refs) })
    const back = await (await (await open(again)).getPage(1)).getAnnotations()
    const kinds = back.map(a => a.subtype).filter(s => s !== 'Popup')
    expect(kinds).toEqual(['Highlight'])
    expect(back.find(a => a.subtype === 'Highlight')!.contentsObj.str).toBe('고침')
  })
})

describe('textUnder', () => {
  const vp = { convertToViewportPoint: (x: number, y: number) => [x, 100 - y] }
  const item = { str: 'The contract term is one year from signing.', transform: [14, 0, 0, 14, 0, 50], width: 300, height: 14 }

  it('takes the words a mark covers, widened to whole words', () => {
    expect(textUnder([{ x: 105, y: 36, width: 95, height: 14 }], [item], vp)).toBe('term is one year')
  })

  it('ignores a line the mark does not cover', () => {
    expect(textUnder([{ x: 0, y: 70, width: 300, height: 14 }], [item], vp)).toBe('')
  })
})

describe('parsePdfDate', () => {
  it('reads time zones', () => {
    expect(parsePdfDate("D:20261017120000+09'00'")).toBe(Date.UTC(2026, 9, 17, 3, 0, 0))
    expect(parsePdfDate('D:20261017030000Z')).toBe(Date.UTC(2026, 9, 17, 3, 0, 0))
    expect(parsePdfDate('D:2026')).toBe(Date.UTC(2026, 0, 1))
    expect(parsePdfDate('nonsense')).toBeNull()
  })
})
