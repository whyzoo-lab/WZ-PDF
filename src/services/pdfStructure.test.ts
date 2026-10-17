// @vitest-environment node
//
// Page edits keep what ties pages to the rest of the document — read back
// through pdf.js, as a reader sees it: bookmarks go to the right page, links
// still jump, form fields still exist, and a deleted page leaves the file.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, StandardFonts } from '@cantoo/pdf-lib'
import { deletePages, insertPagesFromPdf, reorderPages } from './pdfPageService'

const require = createRequire(import.meta.url)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href

const N = (s: string) => PDFName.of(s)

/** A document of `n` pages "<tag> 1…n", with a bookmark per page, a link from the last page to the first, and a text field. */
async function sample(tag: string, n: number, field: string, named = false): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica) // shared by every page
  const pages = Array.from({ length: n }, (_, i) => {
    const p = doc.addPage([300, 300])
    p.drawText(`${tag} ${i + 1}`, { x: 20, y: 260, size: 18, font })
    return p
  })
  // Bookmarks.
  const ctx = doc.context
  const outlineRef = ctx.nextRef()
  const itemRefs = pages.map(() => ctx.nextRef())
  pages.forEach((p, i) => {
    const item = ctx.obj({}) as PDFDict
    item.set(N('Title'), PDFHexString.fromText(`${tag} page ${i + 1}`))
    item.set(N('Parent'), outlineRef)
    item.set(N('Dest'), ctx.obj([p.ref, N('Fit')]))
    if (i > 0) item.set(N('Prev'), itemRefs[i - 1])
    if (i < n - 1) item.set(N('Next'), itemRefs[i + 1])
    ctx.assign(itemRefs[i], item)
  })
  ctx.assign(outlineRef, ctx.obj({ Type: 'Outlines', First: itemRefs[0], Last: itemRefs[n - 1], Count: n }))
  doc.catalog.set(N('Outlines'), outlineRef)
  // A link on the last page to the first (by name when asked).
  let dest: unknown = ctx.obj([pages[0].ref, N('Fit')])
  if (named) {
    doc.catalog.set(N('Dests'), ctx.obj({ start: ctx.obj([pages[0].ref, N('Fit')]) }))
    dest = N('start')
  }
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [20, 20, 120, 40], Border: [0, 0, 0], Dest: dest as never, P: pages[n - 1].ref }))
  pages[n - 1].node.addAnnot(link)
  // A form field on page 1.
  doc.getForm().createTextField(field).addToPage(pages[0], { x: 20, y: 100, width: 150, height: 20 })
  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function inspect(bytes: ArrayBuffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise
  const pageOf = async (dest: unknown): Promise<number | null> => {
    const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest
    if (!Array.isArray(d) || !d[0]) return null
    return (await doc.getPageIndex(d[0])) + 1
  }
  const outline: { title: string; page: number | null; kids: { title: string; page: number | null }[] }[] = []
  for (const o of (await doc.getOutline()) ?? []) {
    const kids = []
    for (const k of o.items) kids.push({ title: k.title, page: await pageOf(k.dest) })
    outline.push({ title: o.title, page: await pageOf(o.dest), kids })
  }
  const texts: string[] = []
  const links: { on: number; to: number | null }[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    texts.push(((await page.getTextContent()).items as { str: string }[]).map(t => t.str).join(''))
    for (const a of await page.getAnnotations()) if (a.subtype === 'Link' && a.dest) links.push({ on: i, to: await pageOf(a.dest) })
  }
  // The form's own list of fields (/AcroForm /Fields), which is what makes a
  // widget a field — pdf.js's getFieldObjects reads nothing in Node.
  const fields = (await PDFDocument.load(bytes)).getForm().getFields().map(f => f.getName()).sort()
  return { texts, outline, links, fields }
}

describe('page edits keep links, bookmarks and fields', () => {
  it('inserting a file brings its pages with working links, bookmarks and fields', async () => {
    const dest = await sample('A', 2, 'name')
    const src = await sample('B', 2, 'name', true)
    const { newBytes } = await insertPagesFromPdf(dest, src, 1, undefined, '계약서.pdf')
    const got = await inspect(newBytes)
    expect(got.texts).toEqual(['A 1', 'B 1', 'B 2', 'A 2'])
    // The document's own bookmarks and the file's, under its name, in page order.
    expect(got.outline.map(o => [o.title, o.page])).toEqual([['A page 1', 1], ['계약서', 2], ['A page 2', 4]])
    expect(got.outline[1].kids).toEqual([{ title: 'B page 1', page: 2 }, { title: 'B page 2', page: 3 }])
    // Each link still jumps within its own document — the named one too.
    expect(got.links).toEqual([{ on: 3, to: 2 }, { on: 4, to: 1 }])
    // Both fields exist; the clashing name was changed.
    expect(got.fields).toEqual(['name', 'name-1'])
  })

  it('deleting pages drops what pointed at them, and the pages themselves', async () => {
    const bytes = await sample('A', 3, 'name')
    const { newBytes } = await deletePages(bytes, [1])
    const got = await inspect(newBytes)
    expect(got.texts).toEqual(['A 2', 'A 3'])
    expect(got.outline.map(o => [o.title, o.page])).toEqual([['A page 1', null], ['A page 2', 1], ['A page 3', 2]])
    expect(got.links).toEqual([]) // it went to the deleted page
    expect(got.fields).toEqual([]) // its only widget was there
    expect(newBytes.byteLength).toBeLessThan(bytes.byteLength)
  })

  it('reordering keeps bookmarks and links on their pages', async () => {
    const { newBytes } = await reorderPages(await sample('A', 3, 'name'), [3, 1, 2])
    const got = await inspect(newBytes)
    expect(got.texts).toEqual(['A 3', 'A 1', 'A 2'])
    expect(got.outline.map(o => o.page)).toEqual([2, 3, 1])
    expect(got.links).toEqual([{ on: 1, to: 2 }])
    expect(got.fields).toEqual(['name'])
  })

  it('does not copy a shared font once per page', async () => {
    const bytes = await sample('A', 6, 'name')
    const { newBytes } = await reorderPages(bytes, [6, 5, 4, 3, 2, 1])
    expect(newBytes.byteLength).toBeLessThan(bytes.byteLength * 1.2)
    const doc = await PDFDocument.load(newBytes)
    const fonts = new Set(doc.getPages().map(p => (p.node.Resources()!.lookup(N('Font'), PDFDict).get(N('F1')) ?? [...p.node.Resources()!.lookup(N('Font'), PDFDict).values()][0]) as PDFRef).map(r => r.toString()))
    expect(fonts.size).toBe(1)
  })
})
