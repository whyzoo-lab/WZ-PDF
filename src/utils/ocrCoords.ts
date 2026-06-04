import type { RawOcrLine, OcrWord } from '../types/ocr'

/**
 * Convert one SDK line (4-point box in canvas pixels, rendered at `renderScale`)
 * to an axis-aligned OcrWord in PDF points. v1 ignores box rotation and stores
 * the bounding box, matching the annotation coordinate convention.
 */
export function lineToWord(line: RawOcrLine, renderScale: number): OcrWord {
  const xs = line.box.map(p => p[0])
  const ys = line.box.map(p => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  return {
    text: line.text.trim(),
    score: line.score,
    x: minX / renderScale,
    y: minY / renderScale,
    width: (maxX - minX) / renderScale,
    height: (maxY - minY) / renderScale,
    rotation: 0,
  }
}
