// Find over a large sheet: the same cells the old cell-by-cell scan found,
// from an index built once, and a search a newer one replaced stops.
import { describe, expect, it } from 'vitest'
import { buildSheetIndex, searchSheetIndex } from './sheetSearch'

/** The old way: every cell, lower-cased, tested. */
function scan(rows: string[][], needle: string): number[] {
  const out: number[] = []
  rows.forEach((row, ri) => row.forEach((cell, ci) => { if (cell.toLowerCase().includes(needle)) out.push(ri, ci) }))
  return out
}

const sheet = (rows: string[][]) => ({ rows, textAt: (ri: number, ci: number) => rows[ri]?.[ci] ?? '' })

describe('sheet search index', () => {
  it('finds the same cells as a scan of every cell, across blocks', async () => {
    const rows = Array.from({ length: 9000 }, (_, r) => [`row ${r}`, r % 7 === 0 ? 'Seoul 서울' : 'busan', `${r * 3}`, ''])
    const { textAt } = sheet(rows)
    const index = (await buildSheetIndex(rows.length, 4, textAt))!
    for (const needle of ['서울', 'seoul', '12', 'row 8999', 'zz']) {
      expect([...(await searchSheetIndex(index, needle, 1e6))!]).toEqual(scan(rows, needle))
    }
  })

  it('counts a cell once however often it holds the word, and never matches across cells or rows', async () => {
    const rows = [['abab', 'ab'], ['a', 'b'], ['x\ny', 'q']]
    const index = (await buildSheetIndex(3, 2, sheet(rows).textAt))!
    expect([...(await searchSheetIndex(index, 'ab', 100))!]).toEqual([0, 0, 0, 1])
    // "a" ends one cell and "b" starts the next: no match.
    expect([...(await searchSheetIndex(index, 'ab', 100))!].filter((_, i) => i % 2 === 0)).not.toContain(1)
    // A newline inside a cell reads as a space.
    expect([...(await searchSheetIndex(index, 'x y', 100))!]).toEqual([2, 0])
  })

  it('stops at the cap', async () => {
    const rows = Array.from({ length: 50 }, () => ['hit', 'hit'])
    const index = (await buildSheetIndex(50, 2, sheet(rows).textAt))!
    expect((await searchSheetIndex(index, 'hit', 10))!.length).toBe(20)
  })

  it('maps columns right when lower-casing changes a cell\'s length', async () => {
    // "İ" lower-cases to two code units; offsets come from the lower-cased row.
    const rows = [['İİ', 'x', 'target'], ['plain', 'target', 'y']]
    const index = (await buildSheetIndex(2, 3, sheet(rows).textAt))!
    expect([...(await searchSheetIndex(index, 'target', 100))!]).toEqual([0, 2, 1, 1])
  })

  it('gives up when told to', async () => {
    const rows = Array.from({ length: 9000 }, () => ['a'])
    const index = (await buildSheetIndex(rows.length, 1, sheet(rows).textAt))!
    expect(await searchSheetIndex(index, 'a', 1e6, async () => true)).toBeNull()
    expect(await buildSheetIndex(rows.length, 1, sheet(rows).textAt, async () => true)).toBeNull()
  })
})
