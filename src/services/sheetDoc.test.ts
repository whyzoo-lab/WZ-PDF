import { describe, it, expect } from 'vitest'
import { writeXlsx } from 'hucre/xlsx'
import type { Cell, Sheet, Workbook } from 'hucre'
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

describe('theme colours', () => {
  // theme1.xml order: dk1, lt1, dk2, lt2, accent1…
  const themeColors = ['000000', 'FFFFFF', '44546A', 'E7E6E6', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72']

  it('reads "Text 1" as dark and "Background 1" as light, as Excel numbers them', () => {
    const sheet: Sheet = {
      name: 'S',
      rows: [['text', 'filled', 'accent']],
      cells: new Map([
        ['0,0', { value: 'text', type: 'string', style: { font: { color: { theme: 1 } } } }],
        ['0,1', { value: 'filled', type: 'string', style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { theme: 0 } } } }],
        ['0,2', { value: 'accent', type: 'string', style: { font: { color: { theme: 4 } } } }],
      ]),
    }
    const [[text, filled, accent]] = bodyCells(parse(renderSheetHtml(sheet, { sheets: [sheet], themeColors } as Workbook).html))
    expect(text.getAttribute('style')).toContain('color:#000000')
    expect(filled.getAttribute('style')).toContain('background:#ffffff')
    expect(accent.getAttribute('style')).toContain('color:#4472c4')
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

  it('draws a block of columns with a spacer either side, keeping the table width', () => {
    const cols = 100
    const sheet: Sheet = { name: 'S', rows: [Array.from({ length: cols }, (_, c) => `v${c}`)] }
    const layout = layoutSheet(sheet, { sheets: [sheet] })
    expect(layout.colLeft.length).toBe(cols + 1)
    const doc = new DOMParser().parseFromString(`${layout.head(40, 60)}<tbody>${layout.rows(0, 1, 40, 60)}</tbody></table>`, 'text/html')
    const widths = Array.from(doc.querySelectorAll('col')).map(col => parseFloat((col as HTMLElement).style.width))
    // Row numbers, the spacer for columns 0–39, columns 40–59, the spacer for 60–99.
    expect(widths.length).toBe(1 + 1 + 20 + 1)
    expect(widths.reduce((a, b) => a + b, 0)).toBe(layout.tableWidth)
    expect(widths[1]).toBe(layout.colLeft[40])
    const letters = Array.from(doc.querySelectorAll('thead th[data-l]')).map(th => th.getAttribute('data-l'))
    expect(letters[0]).toBe('AO')   // column 41
    expect(letters.length).toBe(20)
    const tr = doc.querySelector('tbody tr')!
    expect(tr.children.length).toBe(1 + 1 + 20 + 1)
    const cells = Array.from(tr.querySelectorAll('td[data-c]'))
    expect(cells.map(td => td.getAttribute('data-c'))[0]).toBe('40')
    expect(cells[0].textContent).toBe('v40')
    expect(tr.querySelectorAll('td.wz-sheet-colgap').length).toBe(2)
    // Without a block of columns, nothing changes.
    expect(layout.head()).toBe(layout.tableOpen)
    expect(layout.rows(0, 1)).not.toContain('wz-sheet-colgap')
  })

  it('carries a merge into a block of columns that starts part-way across it, and cuts it at the block\'s end', () => {
    const empty = () => Array.from({ length: 30 }, () => null as string | null)
    const rows = [empty(), empty(), empty()]
    rows[0][2] = 'left'
    rows[1][5] = 'wide'
    const sheet: Sheet = {
      name: 'S',
      rows,
      merges: [
        { startRow: 0, startCol: 2, endRow: 0, endCol: 9 },   // C1:J1, cut by the block's start (column 8)
        { startRow: 1, startCol: 5, endRow: 2, endCol: 12 },  // F2:M3, cut at both ends
      ],
    }
    const layout = layoutSheet(sheet, { sheets: [sheet] })
    const doc = new DOMParser().parseFromString(`${layout.head(8, 11)}<tbody>${layout.rows(0, 3, 8, 11)}</tbody></table>`, 'text/html')
    const trs = Array.from(doc.querySelectorAll('tbody tr'))
    const drawn = (tr: Element) => Array.from(tr.querySelectorAll('td[data-c]'))
      .map(td => [td.getAttribute('data-c'), td.textContent, td.getAttribute('colspan'), td.getAttribute('rowspan')])
    // C1:J1 shows its remaining columns 8–9; column 10 is a cell of its own.
    expect(drawn(trs[0])).toEqual([['8', 'left', '2', null], ['10', '', null, null]])
    // F2:M3 shows columns 8–10 of both its rows, cut at the block's end.
    expect(drawn(trs[1])).toEqual([['8', 'wide', '3', '2']])
    expect(drawn(trs[2])).toEqual([])
    // Every row is as wide as the head: no colspan runs into a spacer.
    const across = (tr: Element) => Array.from(tr.children).reduce((n, el) => n + Number(el.getAttribute('colspan') ?? 1), 0)
    expect(across(trs[0])).toBe(doc.querySelectorAll('col').length)
    expect(across(trs[1])).toBe(doc.querySelectorAll('col').length)
  })

  it('keeps cells that make a row taller beside the drawn columns, as invisible copies', () => {
    const long = '줄바꿈되는 아주 긴 제목 '.repeat(8)
    const rows = [Array.from({ length: 40 }, (_, c) => (c === 30 ? long : c === 31 ? '짧음' : `v${c}`))]
    const cells = new Map<string, Cell>([
      ['0,30', { value: long, type: 'string', style: { alignment: { wrapText: true } } }],
      ['0,31', { value: '짧음', type: 'string', style: { alignment: { wrapText: true } } }],
      ['0,2', { value: 'v2', type: 'string', style: { font: { size: 28 } } }],
    ])
    const sheet: Sheet = { name: 'S', rows, cells }
    const layout = layoutSheet(sheet, { sheets: [sheet] }, { measure: text => text.length * 7 })
    const doc = new DOMParser().parseFromString(`${layout.head(10, 20)}<tbody>${layout.rows(0, 1, 10, 20)}</tbody></table>`, 'text/html')
    const [left, right] = Array.from(doc.querySelectorAll('td.wz-sheet-colgap'))
    // Left of the block: the 28 pt cell; right of it: the wrapped title, not the short one.
    expect(Array.from(left.querySelectorAll('.wz-ghost')).map(g => g.getAttribute('style'))).toEqual([
      expect.stringContaining('font-size:28pt'),
    ])
    const ghosts = Array.from(right.querySelectorAll('.wz-ghost'))
    expect(ghosts.map(g => g.getAttribute('data-t'))).toEqual([long])
    expect(ghosts[0].classList.contains('wz-wrap')).toBe(true)
    expect(right.querySelector('.wz-ghosts')!.getAttribute('aria-hidden')).toBe('true')
    // Their text is not document text: find, copy and read-aloud see only cells.
    expect(left.textContent + right.textContent).toBe('')
    // Every column drawn: no copies.
    expect(layout.rows(0, 1)).not.toContain('wz-ghost')
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

  it('reads TSV by its tabs, even when the text holds commas', async () => {
    const text = '이름\t메모\n홍길동\t1,000원, 현금\n'
    const { workbook, format } = await loadWorkbook(new TextEncoder().encode(text).buffer, '명단.tsv')
    expect(format).toBe('csv')
    expect(workbook.sheets[0].name).toBe('명단')
    expect(workbook.sheets[0].rows).toEqual([['이름', '메모'], ['홍길동', '1,000원, 현금']])
  })

  it('reads PSV by its pipes, quoted pipes included', async () => {
    const text = '이름|메모\n홍길동|"1,000원|현금"\n'
    const { workbook, format } = await loadWorkbook(new TextEncoder().encode(text).buffer, '명단.psv')
    expect(format).toBe('csv')
    expect(workbook.sheets[0].name).toBe('명단')
    expect(workbook.sheets[0].rows).toEqual([['이름', '메모'], ['홍길동', '1,000원|현금']])
  })

  it('sizes each column to its content', async () => {
    const text = 'id,name\n1,"A much longer name than a default column holds"\n'
    const { workbook } = await loadWorkbook(new TextEncoder().encode(text).buffer, 'a.csv')
    const widths = [...parse(renderSheetHtml(workbook.sheets[0], workbook, { csv: true }).html)
      .querySelectorAll('col')].slice(1).map(c => parseInt(c.getAttribute('style')!.replace('width:', '')))
    expect(widths[0]).toBe(64)               // short values: Excel's default column
    expect(widths[1]).toBeGreaterThan(200)   // the long name fits
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
