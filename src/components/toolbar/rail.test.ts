import { describe, it, expect } from 'vitest'
import { itemsThatFit } from './railLayout'

describe('itemsThatFit (what a rail shows before "...")', () => {
  it('shows everything when everything fits', () => {
    expect(itemsThatFit([44, 44, 44], 132, 44)).toBe(3)
    expect(itemsThatFit([44, 44, 44], Infinity, 44)).toBe(3)
  })

  it('keeps room for the "..." button once something has to go', () => {
    // 131 px cannot take three 44 px items; two would fit on their own, but
    // the "..." button needs a place too, so only one shows.
    expect(itemsThatFit([44, 44, 44], 131, 44)).toBe(1)
  })

  it('counts a group gap with the item after it', () => {
    expect(itemsThatFit([44, 53, 44], 141, 44)).toBe(3)
    expect(itemsThatFit([44, 53, 44], 140, 44)).toBe(1)
  })

  it('shows nothing but "..." in a rail too short for one item and it', () => {
    expect(itemsThatFit([44, 44], 60, 44)).toBe(0)
  })
})
