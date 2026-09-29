import { describe, it, expect } from 'vitest'
import { contentBounds, defaultStampSize, hasTransparency, keyOutPaper } from './stampImage'

/** RGBA pixels from [r, g, b, a] tuples. */
const px = (...pixels: number[][]) => new Uint8ClampedArray(pixels.flat())

describe('stamp image clean-up', () => {
  it('keys out white paper and keeps the ink', () => {
    const data = px([255, 255, 255, 255], [250, 248, 245, 255], [200, 30, 30, 255], [120, 20, 20, 255])
    keyOutPaper(data)
    expect([data[3], data[7], data[11], data[15]]).toEqual([0, 0, 255, 255])
  })

  it('fades near-white instead of leaving a hard fringe', () => {
    const data = px([220, 215, 218, 255])
    keyOutPaper(data)
    expect(data[3]).toBeGreaterThan(0)
    expect(data[3]).toBeLessThan(255)
  })

  it('leaves an image alone when it already has transparency', () => {
    expect(hasTransparency(px([255, 255, 255, 255], [200, 0, 0, 0]))).toBe(true)
    expect(hasTransparency(px([255, 255, 255, 255], [200, 0, 0, 255]))).toBe(false)
  })

  it('finds the inked area so scanner margins can be trimmed', () => {
    // 4 x 3, ink at (1,1) and (2,1).
    const w = 4, h = 3
    const data = new Uint8ClampedArray(w * h * 4)
    for (const [x, y] of [[1, 1], [2, 1]]) data[(y * w + x) * 4 + 3] = 255
    expect(contentBounds(data, w, h)).toEqual({ x: 1, y: 1, w: 2, h: 1 })
    expect(contentBounds(new Uint8ClampedArray(w * h * 4), w, h)).toBeNull()
  })

  it('keeps the image proportions — a round seal stays round', () => {
    expect(defaultStampSize(400, 400)).toEqual({ width: 72, height: 72 })
    expect(defaultStampSize(800, 400)).toEqual({ width: 72, height: 36 })
  })
})
