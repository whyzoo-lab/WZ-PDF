import { describe, it, expect } from 'vitest'
import { medianColor } from './sampleBgColor'

describe('medianColor', () => {
  it('returns the per-channel median as a hex string', () => {
    // each channel sorted → [0,255,255], median index 1 = 255
    expect(medianColor([[255, 255, 255], [255, 255, 255], [0, 0, 0]])).toBe('#ffffff')
  })

  it('zero-pads single hex digits', () => {
    expect(medianColor([[1, 2, 3]])).toBe('#010203')
  })

  it('takes the middle value of an odd set per channel', () => {
    // r/g/b each sorted → [10,100,200], median = 100 = 0x64
    expect(medianColor([[10, 10, 10], [200, 200, 200], [100, 100, 100]])).toBe('#646464')
  })

  it('falls back to white when there are no samples', () => {
    expect(medianColor([])).toBe('#FFFFFF')
  })

  it('clamps out-of-range channel values', () => {
    expect(medianColor([[300, -5, 128]])).toBe('#ff0080')
  })
})
