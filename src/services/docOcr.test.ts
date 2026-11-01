import { describe, it, expect } from 'vitest'
import { outsideText, pagesToRead, readingLines } from './docOcr'
import type { OcrWord } from '../types/ocr'

const word = (text: string, x: number, y: number, width = 60, height = 12): OcrWord =>
  ({ text, x, y, width, height, score: 0.9, rotation: 0 })

describe('outsideText', () => {
  it('drops lines lying over the page\'s own text and keeps those in pictures', () => {
    const own = [{ x: 50, y: 100, width: 200, height: 14 }]
    const words = [
      word('본문 다시 읽음', 52, 101, 190),   // the page's text, recognized again
      word('차트 제목', 300, 400),            // inside a picture
      word('반쯤 겹침', 220, 102, 100),        // under half over the text: kept
    ]
    expect(outsideText(words, own).map(w => w.text)).toEqual(['차트 제목', '반쯤 겹침'])
  })

  it('keeps everything on a page without text', () => {
    expect(outsideText([word('스캔', 0, 0)], [])).toHaveLength(1)
  })
})

describe('readingLines', () => {
  it('reads boxes by line, left to right, whatever order they were detected in', () => {
    const words = [word('둘째 줄', 10, 40), word('오른쪽', 200, 11), word('왼쪽', 10, 10), word('셋째', 10, 70)]
    expect(readingLines(words)).toEqual(['왼쪽 오른쪽', '둘째 줄', '셋째'])
  })
})

describe('pagesToRead', () => {
  it('takes the requested pages that exist, sorted, once each', () => {
    expect(pagesToRead(5)).toEqual([1, 2, 3, 4, 5])
    expect(pagesToRead(5, [4, 2, 9, 2, 0, 1.5])).toEqual([2, 4])
  })
})
