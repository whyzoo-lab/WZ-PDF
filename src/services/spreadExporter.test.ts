// @vitest-environment node
//
// The two-page PDF is read back with pdfjs — the same engine the viewer uses —
// so "where is each page on the sheet" is measured the way a reader sees it.
import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib'
import { exportSpreads, sheetSizeFor } from './spreadExporter'

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

const A4: [number, number] = [595, 842]
const A3_LANDSCAPE: [number, number] = [1190, 842]

/** A document whose every page says its own number near its top-left corner. */
async function source(pages: { size: [number, number]; rotate?: number }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  pages.forEach(({ size, rotate }, i) => {
    const page = doc.addPage(size)
    page.drawText(`P${i + 1}`, { x: 20, y: size[1] - 40, size: 24, font })
    if (rotate) page.setRotation(degrees(rotate))
  })
  return doc.save()
}

/** Each sheet's size and where each marker landed on it. */
async function readBack(bytes: Uint8Array, password?: string) {
  const doc = await pdfjs.getDocument({ data: bytes, password }).promise
  const sheets = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const [, , w, h] = page.view
    const items = (await page.getTextContent()).items
      .filter((i): i is typeof i & { str: string; transform: number[] } => 'str' in i && /^P\d+$/.test(i.str))
      .map(i => ({ text: i.str, x: i.transform[4], y: i.transform[5] }))
    sheets.push({ w: Math.round(w), h: Math.round(h), items })
  }
  return sheets
}

describe('exportSpreads', () => {
  it('lays pages out as the two-page view: pairs, and a wide page on a sheet of its own', async () => {
    const bytes = await source([{ size: A4 }, { size: A4 }, { size: A3_LANDSCAPE }, { size: A4 }, { size: A4 }])
    const sheets = await readBack(await exportSpreads(bytes))

    // [1,2] [3] [4,5] — every sheet A3 landscape, the paper a booklet is printed on.
    expect(sheets.map(s => s.items.map(i => i.text))).toEqual([['P1', 'P2'], ['P3'], ['P4', 'P5']])
    for (const s of sheets) expect([s.w, s.h]).toEqual([1190, 842])

    // Left page in the left half, right page in the right half.
    const [p1, p2] = sheets[0].items
    expect(p1.x).toBeLessThan(595)
    expect(p2.x).toBeGreaterThan(595)
    // The A3 page fills its sheet: its marker is where it was on the page.
    expect(sheets[1].items[0].x).toBeCloseTo(20, 0)
  })

  it('keeps a page left without a partner in the left half', async () => {
    // Page 2 is followed by a wide page, and page 4 is the last: both alone.
    const bytes = await source([{ size: A4 }, { size: A4 }, { size: A4 }, { size: A3_LANDSCAPE }, { size: A4 }])
    const sheets = await readBack(await exportSpreads(bytes))
    expect(sheets.map(s => s.items.map(i => i.text))).toEqual([['P1', 'P2'], ['P3'], ['P4'], ['P5']])
    expect(sheets[1].items[0].x).toBeLessThan(595)
    expect(sheets[3].items[0].x).toBeLessThan(595)
  })

  it('turns a page by its /Rotate, as the viewer shows it', async () => {
    // A portrait A4 with /Rotate 90 is shown landscape, so it is a wide page.
    // Turned clockwise, the corner its marker sits in (top-left) ends up
    // top-right.
    const bytes = await source([{ size: A4 }, { size: A4 }, { size: A4, rotate: 90 }])
    const sheets = await readBack(await exportSpreads(bytes))
    expect(sheets.map(s => s.items.map(i => i.text))).toEqual([['P1', 'P2'], ['P3']])
    const p3 = sheets[1].items[0]
    expect(p3.x).toBeGreaterThan(1190 * 0.75)
    expect(p3.y).toBeGreaterThan(842 * 0.75)
  })

  it('locks the result when asked', async () => {
    const bytes = await source([{ size: A4 }, { size: A4 }])
    const locked = await exportSpreads(bytes, { password: 'secret' })
    await expect(pdfjs.getDocument({ data: locked.slice() }).promise).rejects.toThrow(/password/i)
    expect((await readBack(locked, 'secret'))[0].items.map(i => i.text)).toEqual(['P1', 'P2'])
  })
})

describe('sheetSizeFor', () => {
  it('is two typical pages side by side', () => {
    expect(sheetSizeFor([{ width: 595, height: 842 }, { width: 595, height: 842 }, { width: 612, height: 792 }]))
      .toEqual({ width: 1190, height: 842 })
  })
})
