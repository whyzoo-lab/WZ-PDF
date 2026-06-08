import { describe, it, expect } from 'vitest'
import { computeOcrScale } from './ocrInput'

describe('computeOcrScale', () => {
  it('returns 1 when the image already fits', () => {
    expect(computeOcrScale(1754, 1240, 2400)).toBe(1)
    expect(computeOcrScale(1024, 768, 1024)).toBe(1)
  })

  it('scales down by the longest side', () => {
    expect(computeOcrScale(1754, 1240, 1024)).toBeCloseTo(1024 / 1754, 5)
    expect(computeOcrScale(1000, 2000, 1000)).toBe(0.5) // longest side is height
  })

  it('returns 1 for empty dimensions', () => {
    expect(computeOcrScale(0, 0, 1024)).toBe(1)
  })
})
