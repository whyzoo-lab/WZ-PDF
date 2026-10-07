import { describe, it, expect } from 'vitest'
import { writeXlsx } from 'hucre/xlsx'
import type { Sheet, Workbook } from 'hucre'
import {
  loadWorkbook, renderSheetHtml, displayValue, formatGeneral, columnLetter, initialSheet,
  layoutSheet,
} from './sheetDoc'

const toBuffer = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer

function parse(html: string): HTMLTableElement {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.querySelector('table')!
}

/** Body cells of a rendered table, by row, skipping the row-number column. */
function bodyCells(table: HTMLTableElement): HTMLTableCellElement[][] {
  return Array.from(table.tBodies[0].rows).map(tr => Array.from(tr.cells).filter(c => c.tagName === 'TD'))
}

async function workbookOf(sheet: Parameters<typeof writeXlsx>[0]['sheets'][number]) {
  const bytes = await writeXlsx({ sheets: [sheet] })
  return loadWorkbook(toBuffer(bytes as Uint8Array), 'a.xlsx')
}

describe('loadWorkbook + renderSheetHtml (xlsx)', () => {
  it('draws values with their number formats, styles and merges', async () => {
    const { workbook, format } = await workbookOf({
      name: '매출',
      columns: [{ width: 20 }, { width: 12, hidden: true }, { width: 10 }, { width: 10 }],
      rows: [
        [{ value: '제목', style: { font: { bold: true, color: { rgb: 'FF0000' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { rgb: 'FFFF00' } } } }, null, null, null],
        [{ value: 1234.5, style: { numFmt: '#,##0.00' } }, 'hidden', { value: 0.25, style: { numFmt: '0%' } }, true],
      ],
      merges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 3 }],
    })
    expect(format).toBe('xlsx')
    const out = renderSheetHtml(workbook.sheets[0], workbook)
    const table = parse(out.html)
    const rows = bodyCells(table)

    // The merge spans the three visible columns (B is hidden).
    expect(rows[0]).toHaveLength(1)
    expect(rows[0][0].getAttribute('colspan')).toBe('3')
    expect(rows[0][0].textContent).toBe('제목')
    expect(rows[0][0].getAttribute('style')).toMatch(/font-weight:700/)
    expect(rows[0][0].getAttribute('style')).toMatch(/color:#ff0000/)
    expect(rows[0][0].getAttribute('style')).toMatch(/background:#ffff00/)

    expect(rows[1].map(td => td.textContent)).toEqual(['1,234.50', '25%', 'TRUE'])
    expect(rows[1][0].getAttribute('style')).toMatch(/text-align:right/)
    expect(table.textContent).not.toContain('hidden')
  })

  it('keeps column letters and row numbers out of the text find and read-aloud walk', async () => {
    const { workbook } = await workbookOf({ name: 'S', rows: [['a', 'b']] })
    const table = parse(renderSheetHtml(workbook.sheets[0], workbook).html)
    expect(table.textContent).toBe('ab')
    expect(table.querySelector('thead th[data-l="B"]')).not.toBeNull()
    expect(table.querySelector('tbody th[data-l="1"]')).not.toBeNull()
  })

  it('draws a thin border on the left of a cell even though a gridline borders it too', async () => {
    const { workbook } = await workbookOf({
      name: 'S',
      rows: [['x', { value: 'y', style: { border: { left: { style: 'thin', color: { rgb: '0000FF' } } } } }]],
    })
    const [[a]] = bodyCells(parse(renderSheetHtml(workbook.sheets[0], workbook).html))
    // The edge between A1 and B1 is drawn once, by A1, and B1's border wins.
    expect(a.getAttribute('style')).toMatch(/border-right:1px solid #0000ff/)
  })
})

describe('what a file controls never becomes CSS of its own', () => {
  it('strips a font name and colour that try to break out of the style attribute', () => {
    const sheet: Sheet = {
      name: 'S',
      rows: [['x']],
      cells: new Map([['0,0', {
        value: 'x', type: 'string',
        style: { font: { name: 'Arial";background:url(https://evil.example/p)', color: { rgb: 'red;x:url(y)' } } },
      }]]),
    }
    const html = renderSheetHtml(sheet, { sheets: [sheet] }).html
    expect(html).not.toContain('evil.example')
    expect(html).not.toContain('url(')
    // Only letters, digits, spaces and dashes survive in a font name.
    expect(html).toContain('font-family:&quot;Arialbackgroundurlhttpsevilexamplep&quot;')
  })

  it('links only web and mail targets', () => {
    const sheet: Sheet = {
      name: 'S',
      rows: [['a', 'b']],
      cells: new Map([
        ['0,0', { value: 'a', type: 'string', hyperlink: { target: 'javascript:alert(1)' } }],
        ['0,1', { value: 'b', type: 'string', hyperlink: { target: 'https://example.com/' } }],
      ]),
    }
    const html = renderSheetHtml(sheet, { sheets: [sheet] }).html
    expect(html).not.toMatch(/javascript:/i)
    expect(html).toContain('href="https://example.com/"')
  })
})

describe('laid out for print', () => {
  it('drops column letters, row numbers and gridlines, as Excel saves a PDF', () => {
    const sheet: Sheet = { name: 'S', rows: [['a', 'b']] }
    const screen = layoutSheet(sheet, { sheets: [sheet] })
    const paper = layoutSheet(sheet, { sheets: [sheet] }, { print: true })
    const html = `${paper.tableOpen}<tbody>${paper.rows(0, 1)}</tbody></table>`
    expect(html).not.toContain('<th')
    expect(html).not.toContain('--wz-sheet-grid')
    expect(paper.columnCount).toBe(screen.columnCount - 1)
    expect(paper.tableWidth).toBe(screen.tableWidth - 44)
  })
})

describe('pictures', () => {
  it('hangs a picture from the cell it is anchored to, at its own size', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47])
    const sheet: Sheet = {
      name: 'S',
      rows: [['a', null, null], [null, null, null]],
      images: [{ data: png, type: 'png', anchor: { from: { row: 1, col: 2 } }, width: 74, height: 74 }],
    }
    const table = parse(renderSheetHtml(sheet, { sheets: [sheet] }).html)
    const img = table.querySelector('img.wz-sheet-img')!
    expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(img.getAttribute('style')).toBe('width:74px;height:74px')
    // Row 2, column C — the cell the picture belongs to, even though it is empty.
    const cell = img.closest('td')!
    expect(bodyCells(table)[1].indexOf(cell as HTMLTableCellElement)).toBe(2)
    expect(cell.classList.contains('wz-anchor')).toBe(true)
  })

  it('draws no SVG picture', () => {
    const sheet: Sheet = {
      name: 'S', rows: [['a']],
      images: [{ data: new Uint8Array([60]), type: 'svg', anchor: { from: { row: 0, col: 0 } }, width: 10, height: 10 }],
    }
    expect(renderSheetHtml(sheet, { sheets: [sheet] }).html).not.toContain('<img')
  })
})

describe('size', () => {
  it('lays out every row of a large sheet and draws any run of them', () => {
    const total = 215_897
    const rows = Array.from({ length: total }, (_, r) => [r + 1, 'x'])
    const sheet: Sheet = { name: 'S', rows }
    const layout = layoutSheet(sheet, { sheets: [sheet] })
    expect(layout.rowCount).toBe(total)
    expect(layout.rowTop[total]).toBe(total * 20)   // 15 pt default rows
    const doc = new DOMParser().parseFromString(`${layout.tableOpen}<tbody>${layout.rows(200_000, 200_003)}</tbody></table>`, 'text/html')
    const trs = Array.from(doc.querySelectorAll('tbody tr'))
    expect(trs.map(tr => tr.querySelector('th')!.getAttribute('data-l'))).toEqual(['200001', '200002', '200003'])
    expect(trs[0].querySelector('td')!.textContent).toBe('200001')
  })

  it('carries a merge into a run of rows that starts part-way down it', () => {
    const sheet: Sheet = {
      name: 'S',
      rows: [['merged', 'a'], [null, 'b'], [null, 'c'], [null, 'd']],
      merges: [{ startRow: 0, startCol: 0, endRow: 3, endCol: 0 }],
    }
    const layout = layoutSheet(sheet, { sheets: [sheet] })
    const doc = new DOMParser().parseFromString(`${layout.tableOpen}<tbody>${layout.rows(2, 4)}</tbody></table>`, 'text/html')
    const [first, second] = Array.from(doc.querySelectorAll('tbody tr'))
    const carried = first.querySelector('td')!
    expect(carried.textContent).toBe('merged')
    expect(carried.getAttribute('rowspan')).toBe('2')
    // The row below has only its own cell; the merge already covers column A.
    expect(Array.from(second.querySelectorAll('td')).map(td => td.textContent)).toEqual(['d'])
  })

  it('reports an empty sheet', () => {
    const sheet: Sheet = { name: 'S', rows: [[null, null]] }
    expect(renderSheetHtml(sheet, { sheets: [sheet] }).empty).toBe(true)
  })
})

describe('csv', () => {
  it('reads CP949 text from Korean Excel and keeps values as written', async () => {
    // "이름,금액\n홍길동,007" in CP949 — what "CSV로 저장" produces on Korean Windows.
    const bytes = new Uint8Array([
      0xC0, 0xCC, 0xB8, 0xA7, 0x2C, 0xB1, 0xDD, 0xBE, 0xD7, 0x0A,
      0xC8, 0xAB, 0xB1, 0xE6, 0xB5, 0xBF, 0x2C, 0x30, 0x30, 0x37,
    ])
    const { workbook, format } = await loadWorkbook(bytes.buffer, '명단.csv')
    expect(format).toBe('csv')
    expect(workbook.sheets[0].name).toBe('명단')
    expect(workbook.sheets[0].rows).toEqual([['이름', '금액'], ['홍길동', '007']])
    const rows = bodyCells(parse(renderSheetHtml(workbook.sheets[0], workbook, { csv: true }).html))
    expect(rows[1][1].textContent).toBe('007')
    expect(rows[1][1].getAttribute('style')).toMatch(/text-align:right/)
  })
})

describe('helpers', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
  })

  it('prints General numbers the way Excel does', () => {
    expect(formatGeneral(1 / 3)).toBe('0.3333333333')
    expect(formatGeneral(1234.5)).toBe('1234.5')
    expect(formatGeneral(123456789012345)).toBe('1.23457E+14')
    expect(formatGeneral(0)).toBe('0')
  })

  it('shows a formula by its cached result and a date without a format as a date', () => {
    expect(displayValue(null, { value: null, type: 'formula', formula: 'A1*2', formulaResult: 42 })).toBe('42')
    expect(displayValue(new Date(Date.UTC(2026, 9, 6)), undefined)).toBe('2026-10-06')
  })

  it('opens on the sheet Excel had open, unless it is hidden', () => {
    const s = (name: string, hidden = false): Sheet => ({ name, rows: [], hidden })
    expect(initialSheet({ sheets: [s('a'), s('b')], activeSheet: 1 } as Workbook)).toBe(1)
    expect(initialSheet({ sheets: [s('a', true), s('b')], activeSheet: 0 } as Workbook)).toBe(1)
  })
})
