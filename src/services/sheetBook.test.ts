import { describe, it, expect, vi, afterEach } from 'vitest'
import { writeXlsx } from 'hucre/xlsx'
import { SheetBook, BLOCK_ROWS, COL_BLOCK, WHOLE_SHEET_CELLS } from './sheetBook'
import { openSheetHost } from './sheetHost'

const toBuffer = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
const csv = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer

/** A CSV just big enough to be drawn a window at a time. */
function bigCsv(): { bytes: ArrayBuffer; rows: number } {
  const cols = 6
  const rows = Math.ceil(WHOLE_SHEET_CELLS / (cols + 1)) + 50
  const lines = ['a,b,c,d,e,f']
  for (let r = 1; r < rows; r++) lines.push(`r${r},${r * 2},x,y,z,${r === rows - 1 ? '끝줄' : 'w'}`)
  return { bytes: csv(lines.join('\n')), rows }
}

describe('SheetBook', () => {
  it('describes the workbook: sheets, hidden ones, the one to open on', async () => {
    const bytes = await writeXlsx({
      sheets: [
        { name: '숨김', rows: [['x']], hidden: true },
        { name: '보임', rows: [['y']] },
      ],
    } as Parameters<typeof writeXlsx>[0])
    const book = await SheetBook.open(toBuffer(bytes as Uint8Array), 'a.xlsx')
    const info = book.info()
    expect(info.format).toBe('xlsx')
    expect(info.sheets).toEqual([{ name: '숨김', hidden: true }, { name: '보임', hidden: false }])
    expect(info.initial).toBe(1)
  })

  it('lays a small sheet out whole, and a large one with only its first window', async () => {
    const small = await SheetBook.open(csv('a,b\n1,2'), 's.csv')
    const s = small.layout(0)!
    expect(s.windowed).toBe(false)
    expect(s.firstTo).toBe(s.rowCount)
    expect(s.html).toContain('data-r="1"')

    const { bytes, rows } = bigCsv()
    const big = await SheetBook.open(bytes, 'b.csv')
    const b = big.layout(0)!
    expect(b.windowed).toBe(true)
    expect(b.rowCount).toBe(rows)
    expect(b.firstTo).toBe(BLOCK_ROWS * 3)
    expect(b.rowTop.length).toBe(rows + 1)
    // Any block on request, by the layout's id.
    const tail = big.rows(b.id, rows - 10, rows, 0, b.cols).html
    expect(tail).toContain('끝줄')
    expect(tail).not.toContain('data-r="0"')
    // Six columns are drawn whole.
    expect(b.colsWindowed).toBe(false)
    expect(b.firstCols).toBe(6)
  })

  it('draws a wide sheet a block of columns at a time', async () => {
    const cols = 1500
    const lines = Array.from({ length: 50 }, (_, r) => Array.from({ length: cols }, (_, c) => `r${r}c${c}`).join(','))
    const book = await SheetBook.open(csv(lines.join('\n')), 'w.csv')
    const m = book.layout(0)!
    expect(m.windowed).toBe(true)
    expect(m.colsWindowed).toBe(true)
    expect(m.cols).toBe(cols)
    expect(m.firstCols).toBe(COL_BLOCK * 3)
    expect(m.html).toContain(`data-c="${COL_BLOCK * 3 - 1}"`)
    expect(m.html).not.toContain(`data-c="${COL_BLOCK * 3}"`)
    expect(m.tableOpen).toContain('wz-sheet-colgap')
    const far = book.rows(m.id, 0, 50, 1440, cols)
    expect(far.html).toContain('r49c1499')
    expect(far.html).not.toContain('r0c0<')
    expect(far.open.match(/data-l="/g)!.length).toBe(60)
  })

  it('finds over every row of the layout, and a newer search overtakes an older one', async () => {
    const { bytes, rows } = bigCsv()
    const book = await SheetBook.open(bytes, 'b.csv')
    const m = book.layout(0)!
    const cells = await book.find(m.id, '끝줄')
    expect(Array.from(cells!)).toEqual([rows - 1, 5])
    const older = book.find(m.id, 'w')
    const newer = book.find(m.id, 'r1')
    expect(await older).toBeNull()
    expect((await newer)!.length).toBeGreaterThan(0)
  })

  it('forgets the previous sheet\'s layout when another is laid out', async () => {
    const book = await SheetBook.open(csv('a\n1'), 's.csv')
    const first = book.layout(0)!
    const second = book.layout(0)!
    expect(second.id).not.toBe(first.id)
    expect(book.rows(first.id, 0, 1, 0, 1)).toEqual({ open: '', html: '' })
    expect(book.rows(second.id, 0, 1, 0, 1).html).toContain('<tr')
  })

  it('makes the PDF pieces as markup', async () => {
    const book = await SheetBook.open(csv('이름,금액\n홍길동,007'), 's.csv')
    const { css, pieces } = book.pdf(0)
    expect(css).toContain('@page')
    expect(pieces).toBe(1)
    expect(book.pdfPiece(0, 0)).toContain('홍길동')
  })
})

describe('openSheetHost', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('reads in the page where no worker can start', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new TypeError('no workers here') } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = await openSheetHost(csv('a,b\n1,2'), 's.csv')
    expect(warn).toHaveBeenCalled()
    const m = await host.layout(host.info.initial)
    expect(m!.html).toContain('data-r="1"')
    expect((await host.rows(m!.id, 0, 1, 0, m!.cols)).html).toContain('<tr')
  })
})
