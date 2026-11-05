import { describe, expect, it } from 'vitest'
import type { Sheet } from 'hucre'
import {
  colWidthPx, defaultColPx, fitNumber, maxDigitWidth, shorterGeneral, type Measure,
} from './sheetFit'
import { layoutSheet } from './sheetDoc'

// Every character one digit wide: 7 px in Calibri 11, 8 px in 맑은 고딕 11 —
// the widths the app's Chromium measures, rounded (7.43 and 8.07).
const digits: Measure = (text, font) => text.length * (/고딕|Malgun/.test(font.family ?? '') ? 8 : 7)

describe('column widths', () => {
  it('converts stored widths as Excel does (ECMA-376 §18.3.1.13)', () => {
    expect(colWidthPx(9.140625, 7)).toBe(64)   // Excel's default column, Calibri 11
    expect(colWidthPx(9, 8)).toBe(72)          // Korean Excel's default column, 맑은 고딕 11
    expect(colWidthPx(10, 7)).toBe(70)
    expect(colWidthPx(0, 7)).toBe(0)
  })

  it('sizes an unsized column at eight digits, rounded up to 8 px', () => {
    expect(defaultColPx(7)).toBe(64)
    expect(defaultColPx(8)).toBe(72)
  })

  it('takes the widest digit, rounded', () => {
    expect(maxDigitWidth({ family: '맑은 고딕' }, (t) => (t === '4' ? 8.07 : 7.9))).toBe(8)
  })

  it('makes a Korean workbook\'s columns as wide as Excel draws them', () => {
    const sheet: Sheet = { name: 'S', rows: [[1, 2]], columns: [{ width: 15 }] }
    const korean = layoutSheet(sheet, { sheets: [sheet], defaultFont: { name: '맑은 고딕', size: 11 } }, { measure: digits })
    const calibri = layoutSheet(sheet, { sheets: [sheet] }, { measure: digits })
    // 15 digits wide plus padding; the second column has no width of its own.
    expect(korean.tableOpen).toContain('<col style="width:120px"><col style="width:72px">')
    expect(calibri.tableOpen).toContain('<col style="width:105px"><col style="width:64px">')
  })
})

describe('a number that does not fit', () => {
  const font = {}

  it('is shown whole when it fits', () => {
    expect(fitNumber(12345678, '12345678', true, 60, font, digits)).toBe('12345678')
  })

  it('loses decimals, then goes scientific, in General', () => {
    expect(shorterGeneral(1234.5678, '1234.5678')).toEqual([
      '1234.568', '1234.57', '1234.6', '1235',
      '1.23457E+03', '1.2346E+03', '1.235E+03', '1.23E+03', '1.2E+03', '1E+03',
    ])
    expect(fitNumber(1234.5678, '1234.5678', true, 30, font, digits)).toBe('1235')
    expect(fitNumber(123456789, '123456789', true, 60, font, digits)).toBe('1.23E+08')
  })

  it('fills the cell with # in any other format, or when nothing fits', () => {
    expect(fitNumber(1234567, '1,234,567', false, 60, font, digits)).toBe('########')
    expect(fitNumber(new Date(Date.UTC(2026, 0, 2)), '2026-01-02', false, 40, font, digits)).toBe('#####')
    expect(fitNumber(123456789, '123456789', true, 20, font, digits)).toBe('##')
  })

  it('is drawn shortened in the sheet, never cut, with the full value as its tooltip', () => {
    const sheet: Sheet = {
      name: 'S',
      rows: [[1234567890, 'next'], [1234567, 'next']],
      columns: [{ width: 9.140625 }],
      cells: new Map([['1,0', { value: 1234567, type: 'number', style: { numFmt: '#,##0' } }]]),
    }
    const layout = layoutSheet(sheet, { sheets: [sheet] }, { measure: digits })
    const html = layout.rows(0, 2)
    // 64 px column, 60 px of room: eight characters of 7 px.
    expect(html).toContain('title="1234567890"')
    expect(html).toContain('>1.23E+09<')
    expect(html).toContain('title="1,234,567"')
    expect(html).toContain('>########<')
    // Find still matches the value itself.
    expect(layout.textAt(0, 0)).toBe('1234567890')
  })

  it('uses the whole width of a merged cell', () => {
    const sheet: Sheet = {
      name: 'S',
      rows: [[1234567890, null]],
      columns: [{ width: 9.140625 }, { width: 9.140625 }],
      merges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 1 }],
    }
    const html = layoutSheet(sheet, { sheets: [sheet] }, { measure: digits }).rows(0, 1)
    expect(html).toContain('>1234567890<')
    expect(html).not.toContain('title=')
  })
})
