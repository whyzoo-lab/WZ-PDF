import { describe, expect, it } from 'vitest'
import { compression, declaredAt, MAX_SHEET_PX, pageY, spacers } from './sheetWindow'

/** rowTop for `n` rows of 20 px. */
const rows = (n: number) => Float64Array.from({ length: n + 1 }, (_, i) => i * 20)

describe('a sheet taller than a page can be', () => {
  it('is not touched below the limit', () => {
    expect(compression(MAX_SHEET_PX)).toBe(1)
    const top = rows(1000)
    expect(spacers(top, 100, 400, 1)).toEqual({ above: 2000, below: 12000 })
    for (const y of [0, 1999, 2000, 5000, 8000, 19999]) {
      expect(declaredAt(y, top, 100, 400, 1)).toBe(y)
      expect(pageY(y, top, 100, 400, 1)).toBe(y)
    }
  })

  it('keeps 2,100,000 rows under the cap at 3x zoom, every row reachable', () => {
    const top = rows(2_100_000)
    const k = compression(top[2_100_000])
    expect(k).toBeCloseTo(42_000_000 / MAX_SHEET_PX)
    const from = 2_099_700, to = 2_100_000
    const { above, below } = spacers(top, from, to, k)
    const page = above + (top[to] - top[from]) + below
    expect(page * 3).toBeLessThan(33_554_432)
    // The bottom of the page is the end of the last row.
    expect(declaredAt(page, top, from, to, k)).toBe(top[to])
    // Dragging to the middle lands in the middle of the sheet.
    const mid = declaredAt(page / 2, top, 0, 300, k)
    expect(mid / top[2_100_000]).toBeCloseTo(0.5, 2)
  })

  it('draws the rows at their real height, the spacers shrunk', () => {
    const top = rows(2_100_000)
    const k = compression(top[2_100_000])
    const from = 1_000_000, to = 1_000_300
    const { above } = spacers(top, from, to, k)
    expect(above).toBeCloseTo(top[from] / k)
    // One row further down the page is one row further down the sheet.
    expect(declaredAt(above + 40, top, from, to, k) - declaredAt(above + 20, top, from, to, k)).toBe(20)
    // In a spacer, a px stands for k.
    expect(declaredAt(above - 10, top, from, to, k)).toBeCloseTo(top[from] - 10 * k)
  })

  it('pageY is the inverse of declaredAt, in the rows and in the spacers', () => {
    const top = rows(2_100_000)
    const k = compression(top[2_100_000])
    const from = 1_000_000, to = 1_000_300
    for (const d of [0, 123_456, top[from], top[from] + 777, top[to], top[to] + 5_000_000, top[2_100_000]]) {
      expect(declaredAt(pageY(d, top, from, to, k), top, from, to, k)).toBeCloseTo(d, 3)
    }
  })

  it('keeps a row in view where it was when the drawn block moves', () => {
    // What SheetView does on scrolling past a block: the row at the top of
    // the view, found with the old block, is put back at the same y.
    const top = rows(2_100_000)
    const k = compression(top[2_100_000])
    const y = spacers(top, 1_000_000, 1_000_300, k).above + 3000   // 150 rows into the block
    const d = declaredAt(y, top, 1_000_000, 1_000_300, k)
    const moved = pageY(d, top, 1_000_100, 1_000_400, k) - y
    // The rows moved up by 100 rows less their share of the shrunk spacer…
    expect(moved).toBeCloseTo(-2000 * (1 - 1 / k))
    // …and the view, moved by as much, shows the same row.
    expect(declaredAt(y + moved, top, 1_000_100, 1_000_400, k)).toBeCloseTo(d)
  })
})
