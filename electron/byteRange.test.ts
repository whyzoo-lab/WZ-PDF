import { describe, it, expect } from 'vitest'
import { MAX_RANGE_BYTES, isValidByteRange } from './security'

describe('isValidByteRange', () => {
  it('accepts a range inside the file', () => {
    expect(isValidByteRange(0, 1024, 4096)).toBe(true)
  })

  it('accepts a range ending exactly at the end of the file', () => {
    expect(isValidByteRange(3072, 1024, 4096)).toBe(true)
  })

  it('rejects a range that runs past the end', () => {
    expect(isValidByteRange(3073, 1024, 4096)).toBe(false)
  })

  it('rejects negative, empty, fractional and non-numeric input', () => {
    const bad: [unknown, unknown][] = [
      [-1, 10], [0, 0], [1.5, 10], [0, 2.5], ['0', 10], [0, null], [Number.NaN, 1], [0, Infinity],
    ]
    for (const [offset, length] of bad) {
      expect(isValidByteRange(offset, length, 4096), `${String(offset)}, ${String(length)}`).toBe(false)
    }
  })

  it('caps what a single call may carry', () => {
    expect(isValidByteRange(0, MAX_RANGE_BYTES, MAX_RANGE_BYTES * 4)).toBe(true)
    expect(isValidByteRange(0, MAX_RANGE_BYTES + 1, MAX_RANGE_BYTES * 4)).toBe(false)
  })

  it('rejects an offset that would overflow a safe integer', () => {
    expect(isValidByteRange(Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER)).toBe(false)
  })
})
