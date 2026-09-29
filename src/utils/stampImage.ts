/**
 * Turning an uploaded picture of a stamp into something that stamps well.
 *
 * A scanned seal is red ink on white paper, and placed as-is the paper comes
 * with it: a white rectangle that hides the document's text around the seal.
 * So an image with no transparency of its own has its paper keyed out, the
 * margins the scanner left are trimmed off, and it is kept at its own
 * proportions — it used to be forced into 100 x 40, which flattened a round
 * seal into an oval.
 *
 * The pixel work is pure (and tested); only `prepareStampImage` needs a canvas.
 */
import type { StampSize } from '../services/stampLibrary'

/** Longest side of the stored image, px. Enough for print, small to embed. */
export const STAMP_MAX_PIXELS = 800
/** A new stamp's longer side, PDF points (~25 mm) — about a seal's size. */
export const DEFAULT_STAMP_LONG_SIDE = 72

/** Channel minimum at or above which a pixel is paper, and below which it is ink. */
const PAPER = 235
const INK = 200

/** Whether any pixel is already see-through — then the image knows its own shape. */
export function hasTransparency(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true
  return false
}

/**
 * Make white paper transparent, in place. Near-white fades out gradually
 * between INK and PAPER, so the anti-aliased edge of the ink does not turn
 * into a hard white fringe.
 */
export function keyOutPaper(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const lightest = Math.min(data[i], data[i + 1], data[i + 2])
    if (lightest >= PAPER) data[i + 3] = 0
    else if (lightest > INK) data[i + 3] = Math.round(data[i + 3] * (PAPER - lightest) / (PAPER - INK))
  }
}

/** Bounding box of the visible pixels, or null if there are none. */
export function contentBounds(data: Uint8ClampedArray, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** A first size for a stamp of these pixel proportions. */
export function defaultStampSize(pixelWidth: number, pixelHeight: number): StampSize {
  const k = DEFAULT_STAMP_LONG_SIDE / Math.max(pixelWidth, pixelHeight)
  return { width: Math.round(pixelWidth * k * 10) / 10, height: Math.round(pixelHeight * k * 10) / 10 }
}

/** Decode, clean up and size an uploaded stamp image. */
export async function prepareStampImage(file: Blob): Promise<StampSize & { src: string }> {
  const bitmap = await createImageBitmap(file)
  const k = Math.min(1, STAMP_MAX_PIXELS / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * k))
  const h = Math.max(1, Math.round(bitmap.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()

  const pixels = ctx.getImageData(0, 0, w, h)
  if (!hasTransparency(pixels.data)) keyOutPaper(pixels.data)
  const box = contentBounds(pixels.data, w, h) ?? { x: 0, y: 0, w, h }

  const out = document.createElement('canvas')
  out.width = box.w
  out.height = box.h
  out.getContext('2d')!.putImageData(pixels, -box.x, -box.y)
  return { src: out.toDataURL('image/png'), ...defaultStampSize(box.w, box.h) }
}
