import { describe, it, expect } from 'vitest'
import { buildSpreads, spreadIndexOf, type PageSize } from './spreadLayout'

const A4 = { width: 595, height: 842 }
const A4_LANDSCAPE = { width: 842, height: 595 }
const A3_LANDSCAPE = { width: 1191, height: 842 }
const LETTER = { width: 612, height: 792 }

describe('buildSpreads', () => {
  it('pairs pages when sizes are not known yet', () => {
    expect(buildSpreads(5, null)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('pairs a document of one shape as before', () => {
    expect(buildSpreads(4, [A4, A4, A4, A4])).toEqual([[1, 2], [3, 4]])
  })

  it('shows a landscape page among portrait ones on its own row', () => {
    // 1-2 pair, 3 is A3 landscape, pairing restarts at 4.
    expect(buildSpreads(6, [A4, A4, A3_LANDSCAPE, A4, A4, A4])).toEqual([[1, 2], [3], [4, 5], [6]])
  })

  it('does not strand the page before a wide one in a pair with it', () => {
    expect(buildSpreads(4, [A4, A4_LANDSCAPE, A4, A4])).toEqual([[1], [2], [3, 4]])
  })

  it('keeps a deck of landscape slides paired', () => {
    expect(buildSpreads(4, [A4_LANDSCAPE, A4_LANDSCAPE, A4_LANDSCAPE, A4_LANDSCAPE])).toEqual([[1, 2], [3, 4]])
  })

  it('pairs slightly different portrait sizes', () => {
    expect(buildSpreads(2, [A4, LETTER])).toEqual([[1, 2]])
  })

  it('judges width as displayed, after rotation', () => {
    // Turned 90°, the landscape page stands upright among sideways portraits.
    const sizes: PageSize[] = [A4, A4, A4_LANDSCAPE, A4]
    expect(buildSpreads(4, sizes, 90)).toEqual([[1, 2], [3, 4]])
  })

  it('treats a page whose size is still missing as ordinary', () => {
    expect(buildSpreads(3, [A4, undefined, A4])).toEqual([[1, 2], [3]])
  })
})

describe('spreadIndexOf', () => {
  const spreads = [[1, 2], [3], [4, 5]]
  it('finds the row holding a page', () => {
    expect(spreadIndexOf(spreads, 2)).toBe(0)
    expect(spreadIndexOf(spreads, 3)).toBe(1)
    expect(spreadIndexOf(spreads, 5)).toBe(2)
  })
  it('clamps pages outside the document', () => {
    expect(spreadIndexOf(spreads, 0)).toBe(0)
    expect(spreadIndexOf(spreads, 9)).toBe(2)
  })
})
