import { describe, it, expect } from 'vitest'
import { lineToWord } from './ocrCoords'
import type { RawOcrLine } from '../types/ocr'

describe('lineToWord', () => {
  it('converts an axis-aligned px box to PDF points by dividing by renderScale', () => {
    const line: RawOcrLine = {
      box: [[15, 30], [75, 30], [75, 60], [15, 60]], // px
      text: 'hello',
      score: 0.9,
    }
    const w = lineToWord(line, 1.5)
    expect(w).toEqual({
      text: 'hello', score: 0.9,
      x: 10, y: 20, width: 40, height: 20, rotation: 0,
    })
  })

  it('takes the bounding box of a skewed quad (min/max of all 4 points)', () => {
    const line: RawOcrLine = {
      box: [[30, 30], [90, 36], [90, 66], [30, 60]],
      text: 'x', score: 0.5,
    }
    const w = lineToWord(line, 1.5)
    // minX=30,minY=30,maxX=90,maxY=66 → /1.5
    expect(w.x).toBe(20)
    expect(w.y).toBe(20)
    expect(w.width).toBe(40)
    expect(w.height).toBe(24)
  })

  it('trims empty text to empty string and keeps score', () => {
    const line: RawOcrLine = { box: [[0,0],[3,0],[3,3],[0,3]], text: '  ', score: 0.1 }
    expect(lineToWord(line, 1).text).toBe('')
  })
})
