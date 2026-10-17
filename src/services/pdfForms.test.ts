// @vitest-environment node
//
// A form filled in the app and saved reads back with the values in it — read
// through pdf.js, the way a reader gets them — and its fields are found and
// described the way the page shows them.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PDFDocument } from '@cantoo/pdf-lib'
import { exportPdf } from './pdfExporter'
import { readPageWidgets, formValuesOf, applyFormStorage } from './pdfForms'
import { hidePageComments, COMMENT_RENDER } from './pdfCommentImport'
import type { Annotation, FormValue } from '../types/annotation'
import type { ViewerDoc } from '../types/viewerDoc'

const require = createRequire(import.meta.url)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href
const FONT = readFileSync(new URL('../../public/fonts/NotoSansKR-Regular.otf', import.meta.url))

beforeAll(() => {
  vi.stubGlobal('document', { baseURI: 'http://app.test/' })
  vi.stubGlobal('fetch', async () => new Response(FONT))
})
afterAll(() => { vi.unstubAllGlobals() })

async function formPdf(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 400])
  const form = doc.getForm()
  form.createTextField('name').addToPage(page, { x: 50, y: 330, width: 200, height: 24 })
  form.createCheckBox('agree').addToPage(page, { x: 50, y: 290, width: 16, height: 16 })
  const size = form.createRadioGroup('size')
  size.addOptionToPage('S', page, { x: 50, y: 250, width: 14, height: 14 })
  size.addOptionToPage('L', page, { x: 80, y: 250, width: 14, height: 14 })
  const city = form.createDropdown('city')
  city.addOptions(['Seoul', 'Busan'])
  city.addToPage(page, { x: 50, y: 200, width: 120, height: 22 })
  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const value = (fieldName: string, v: FormValue): Annotation =>
  ({ id: fieldName, type: 'formValue', fieldName, value: v, page: 1, x: 0, y: 0, width: 0, height: 0, rotation: 0 })

async function open(data: ArrayBuffer | Blob) {
  return pdfjs.getDocument({ data: new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data.slice(0)) }).promise
}

describe('form fields', () => {
  it('are found with their kind, place and options', async () => {
    const doc = await open(await formPdf())
    const widgets = await readPageWidgets(await doc.getPage(1) as never, 1)
    const byName = (n: string) => widgets.filter(w => w.name === n)
    const name = byName('name')[0]
    expect(name).toMatchObject({ kind: 'text', value: '' })
    // pdf-lib widens the widget by half its border; the box is where it was put.
    expect(Object.values(name.rect).map(Math.round)).toEqual([50, 46, 201, 25])
    expect(byName('agree')[0]).toMatchObject({ kind: 'checkbox', value: false })
    expect(byName('size').map(w => w.onValue)).toEqual(['S', 'L'])
    expect(byName('city')[0].options?.map(o => o.value)).toEqual(['Seoul', 'Busan'])
  })

  it('save with what was filled in, Korean included', async () => {
    const saved = await exportPdf(await formPdf(), [
      value('name', '김철수'), value('agree', true), value('size', 'L'), value('city', 'Busan'),
    ])
    const doc = await open(saved)
    const widgets = await readPageWidgets(await doc.getPage(1) as never, 1)
    const got = Object.fromEntries(widgets.map(w => [w.name + (w.kind === 'radio' ? `:${w.onValue}` : ''), w.value]))
    expect(got).toMatchObject({ name: '김철수', agree: true, 'size:S': 'L', city: 'Busan' })
    // The text field has an appearance drawn in the embedded Korean font.
    const ops = await (await doc.getPage(1)).getOperatorList()
    expect(ops.fnArray).toContain(pdfjs.OPS.showText)
  })

  it('are left out of the page picture but printed with the values filled in', async () => {
    const doc = await open(await formPdf())
    const vdoc = doc as unknown as ViewerDoc
    const page = await doc.getPage(1)
    await hidePageComments(vdoc, 1)
    const drawn = async (intent: 'display' | 'print') =>
      (await page.getOperatorList({ intent, annotationMode: COMMENT_RENDER.annotationMode })).fnArray.filter(f => f === pdfjs.OPS.beginAnnotation).length
    expect(await drawn('display')).toBe(0)
    await applyFormStorage(vdoc, 1, [value('name', 'Kim'), value('agree', true)])
    expect(await drawn('print')).toBeGreaterThan(0)
  })

  it('keeps one value per field name', () => {
    const m = formValuesOf([value('a', 'x'), value('b', true)])
    expect([...m]).toEqual([['a', 'x'], ['b', true]])
  })
})
