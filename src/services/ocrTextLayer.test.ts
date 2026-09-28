import { describe, it, expect } from 'vitest'
import { placeOcrWords } from './ocrTextLayer'
import type { OcrPageResult, OcrWord } from '../types/ocr'
import type { ViewerDoc } from '../types/viewerDoc'

const word = (text: string, x: number, y: number, width: number, height: number): OcrWord =>
  ({ text, score: 1, x, y, width, height, rotation: 0 })

const done = (page: number, words: OcrWord[]): OcrPageResult => ({ page, words, status: 'done', durationMs: 1 })

/**
 * A doc whose pages are 200x100 pt. `rotate` mimics pdfjs's viewport for a page
 * with /Rotate: the viewport (what the reader sees, and what OCR measured) is
 * mapped back into PDF user space by convertToPdfPoint.
 */
function doc(opts: { nativeText?: Record<number, string>; rotate?: 0 | 90 } = {}): ViewerDoc {
  return {
    numPages: 3,
    getPage: async (n: number) => ({
      getTextContent: async () => ({ items: opts.nativeText?.[n] ? [{ str: opts.nativeText[n] }] : [{ str: '  ' }] }),
      getViewport: () => ({
        convertToPdfPoint: (vx: number, vy: number) =>
          // 0°: flip y. 90° (page shown turned clockwise): viewport x runs up the
          // page's y axis and viewport y along its x axis.
          opts.rotate === 90 ? [vy, vx] : [vx, 100 - vy],
      }),
    }),
  } as unknown as ViewerDoc
}

describe('placeOcrWords', () => {
  it('puts each word on its baseline in PDF user space, unrotated', async () => {
    const runs = await placeOcrWords(doc(), new Map([[1, done(1, [word('스캔', 10, 20, 40, 10)])]]))
    const [run] = runs.get(1)!
    expect(run.text).toBe('스캔')
    expect(run.x).toBeCloseTo(10)
    expect(run.y).toBeCloseTo(100 - (20 + 10 * 0.82)) // baseline near the bottom of the box
    expect(run.width).toBeCloseTo(40)
    expect(run.height).toBe(10)
    expect(run.angle).toBeCloseTo(0)
  })

  it('follows a rotated page, so the text runs the way the reader saw it', async () => {
    const runs = await placeOcrWords(doc({ rotate: 90 }), new Map([[1, done(1, [word('A', 10, 20, 40, 10)])]]))
    const [run] = runs.get(1)!
    expect(run.width).toBeCloseTo(40)
    expect(run.angle).toBeCloseTo(90)
  })

  it('skips pages that already have their own text, so nothing is found twice', async () => {
    const runs = await placeOcrWords(
      doc({ nativeText: { 2: 'real text' } }),
      new Map([[1, done(1, [word('a', 0, 0, 5, 5)])], [2, done(2, [word('b', 0, 0, 5, 5)])]]),
    )
    expect([...runs.keys()]).toEqual([1])
  })

  it('ignores failed and empty recognitions', async () => {
    const failed: OcrPageResult = { page: 1, words: [word('x', 0, 0, 5, 5)], status: 'error', durationMs: 1 }
    const runs = await placeOcrWords(doc(), new Map([[1, failed], [2, done(2, [word('  ', 0, 0, 5, 5)])]]))
    expect(runs.size).toBe(0)
  })
})
