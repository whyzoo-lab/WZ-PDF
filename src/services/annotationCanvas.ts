import type { Annotation } from '../types/annotation'
import { annotationsForPage, isVolatile } from '../types/annotation'

/** Resolves once the image is decoded; rejects if the data URL is invalid. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

/**
 * Paint a page's lasting annotations onto a canvas already holding the page.
 *
 * One copy for print and for building a PDF from rendered pages (HWP, images):
 * the two used to carry near-identical versions of this loop. Coordinates are
 * PDF points, so `scale` is the canvas's pixels per point. Volatile markups
 * (pen, rectangle) are skipped — they never leave the screen.
 *
 * A stamp image that fails to decode is logged and left out rather than
 * failing the page.
 */
export async function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  pageNumber: number,
  scale: number,
): Promise<void> {
  const { width, height } = ctx.canvas
  for (const ann of annotationsForPage(annotations, pageNumber)) {
    if (isVolatile(ann)) continue

    if (ann.type === 'stamp' || ann.type === 'signature') {
      try {
        const img = await loadImage(ann.src)
        ctx.save()
        ctx.translate((ann.x + ann.width / 2) * scale, (ann.y + ann.height / 2) * scale)
        ctx.rotate((ann.rotation * Math.PI) / 180)
        ctx.drawImage(img, -(ann.width / 2) * scale, -(ann.height / 2) * scale, ann.width * scale, ann.height * scale)
        ctx.restore()
      } catch (err) {
        console.error('[annotations] failed to draw an image annotation:', err)
      }
    } else if (ann.type === 'watermark') {
      ctx.save()
      ctx.font = `${ann.fontSize * scale}px sans-serif`
      ctx.fillStyle = ann.color
      ctx.globalAlpha = ann.opacity
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.translate(width / 2, height / 2)
      ctx.rotate((ann.rotation * Math.PI) / 180)
      ctx.fillText(ann.text, 0, 0)
      ctx.restore()
    } else if (ann.type === 'textEdit') {
      ctx.fillStyle = ann.background
      ctx.fillRect(ann.x * scale, ann.y * scale, ann.width * scale, ann.height * scale)
      ctx.fillStyle = ann.color
      ctx.font = `${ann.fontSize * scale}px sans-serif`
      ctx.textBaseline = 'top'
      ctx.fillText(ann.text, ann.x * scale + 2, ann.y * scale + 2)
    }
  }
}
