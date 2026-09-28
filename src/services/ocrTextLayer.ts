import type { OcrPageResult } from '../types/ocr'
import type { ViewerDoc } from '../types/viewerDoc'

/**
 * A run of text to write invisibly into a saved PDF, in PDF user space.
 * `x`/`y` is where the baseline starts, `width` its length along the baseline,
 * `angle` the baseline's direction in degrees.
 */
export interface PlacedRun {
  text: string
  x: number
  y: number
  width: number
  height: number
  angle: number
}

/** Where the baseline sits inside a recognized box, measured from its top. */
export const BASELINE_RATIO = 0.82

interface PdfjsLikePage {
  getTextContent: () => Promise<{ items: unknown[] }>
  getViewport: (o: { scale: number }) => { convertToPdfPoint: (x: number, y: number) => number[] }
}

/**
 * Turn what OCR recognized into text that can be written into the saved PDF.
 *
 * OCR boxes are in the page as the reader saw it (pdfjs viewport, scale 1,
 * top-left origin). A saved file needs PDF user space, which differs whenever
 * the page has a /Rotate or a MediaBox that does not start at 0,0 — scanners
 * produce both. pdfjs already knows that mapping, so each box's baseline is
 * converted through the page's own viewport rather than by flipping y.
 *
 * Pages that already carry text are skipped: writing the recognized copy on top
 * would make every search hit and every copy come out twice.
 */
export async function placeOcrWords(
  doc: ViewerDoc,
  results: Map<number, OcrPageResult>,
): Promise<Map<number, PlacedRun[]>> {
  const out = new Map<number, PlacedRun[]>()
  for (const [pageNum, result] of results) {
    if (result.status !== 'done') continue
    const words = result.words.filter(w => w.text.trim().length > 0 && w.width > 0 && w.height > 0)
    if (words.length === 0) continue

    const page = (await doc.getPage(pageNum)) as unknown as PdfjsLikePage
    const content = await page.getTextContent()
    const hasOwnText = content.items.some(
      it => !!it && typeof it === 'object' && 'str' in it && String((it as { str: unknown }).str).trim().length > 0,
    )
    if (hasOwnText) continue

    const viewport = page.getViewport({ scale: 1 })
    const runs = words.map(w => {
      const baseline = w.y + w.height * BASELINE_RATIO
      const [sx, sy] = viewport.convertToPdfPoint(w.x, baseline)
      const [ex, ey] = viewport.convertToPdfPoint(w.x + w.width, baseline)
      return {
        text: w.text,
        x: sx,
        y: sy,
        width: Math.hypot(ex - sx, ey - sy),
        height: w.height,
        angle: (Math.atan2(ey - sy, ex - sx) * 180) / Math.PI,
      }
    })
    out.set(pageNum, runs)
  }
  return out
}
