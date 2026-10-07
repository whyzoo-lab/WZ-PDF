import { describe, expect, it } from 'vitest'
import { canBatch, splitBatch } from './ttsBatch'

describe('splitBatch', () => {
  it('cuts the flat output into one clip per sentence, without the padding', () => {
    // Three sentences padded to rows of 6 samples, spoken for 4, 6 and 2.
    const wav = [1, 1, 1, 1, 0, 0, 2, 2, 2, 2, 2, 2, 3, 3, 0, 0, 0, 0]
    const clips = splitBatch(wav, [0.4, 0.6, 0.2], 10)
    expect(clips.map(c => [...c])).toEqual([[1, 1, 1, 1], [2, 2, 2, 2, 2, 2], [3, 3]])
  })

  it('never reads past a row, even when the duration says more', () => {
    expect([...splitBatch([5, 5, 6, 6], [9, 9], 10)[1]]).toEqual([6, 6])
  })

  it('refuses output that does not divide into its sentences', () => {
    expect(() => splitBatch([1, 2, 3], [0.1, 0.1], 10)).toThrow()
  })
})

describe('canBatch', () => {
  it('batches several short texts, and not one alone or one too long for a single piece', () => {
    expect(canBatch(['a', 'b'], ['ko', 'ko'])).toBe(true)
    expect(canBatch(['a'], ['ko'])).toBe(false)
    expect(canBatch(['가'.repeat(121), 'b'], ['ko', 'ko'])).toBe(false)
    expect(canBatch(['a'.repeat(200), 'b'], ['en', 'en'])).toBe(true)
  })
})
