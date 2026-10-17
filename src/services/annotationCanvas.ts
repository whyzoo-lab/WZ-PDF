import type { Annotation } from '../types/annotation'
import { annotationsForPage, isVolatile, isTextMarkup } from '../types/annotation'
import { FILL_BASELINE, MARK_STROKE, markShape } from './fillMarks'

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
 *
 * Comments (highlights, underlines, strike-throughs, note icons) are drawn
 * only when `comments` is set — print wants them, while a PDF built from
 * rendered pages writes them as real annotations instead (services/pdfComments).
 */
export async function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  pageNumber: number,
  scale: number,
  { comments = false }: { comments?: boolean } = {},
): Promise<void> {
  const { width, height } = ctx.canvas
  for (const ann of annotationsForPage(annotations, pageNumber)) {
    if (isVolatile(ann)) continue

    if (isTextMarkup(ann)) {
      if (comments) drawMarkup(ctx, ann.type, ann.color, ann.rects, scale)
      continue
    }
    if (ann.type === 'fill') {
      ctx.save()
      ctx.fillStyle = ctx.strokeStyle = ann.color
      if (ann.mark === 'text') {
        ctx.font = `${ann.fontSize * scale}px sans-serif`
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(ann.text, ann.x * scale, (ann.y + ann.fontSize * FILL_BASELINE) * scale)
      } else {
        const shape = markShape(ann.mark)
        const w = ann.width * scale, h = ann.height * scale, x0 = ann.x * scale, y0 = ann.y * scale
        ctx.lineWidth = MARK_STROKE * h
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        for (const line of shape.lines) {
          ctx.beginPath()
          line.forEach(([x, y], i) => (i ? ctx.lineTo(x0 + x * w, y0 + y * h) : ctx.moveTo(x0 + x * w, y0 + y * h)))
          ctx.stroke()
        }
        if (shape.dot) {
          ctx.beginPath()
          ctx.arc(x0 + shape.dot.cx * w, y0 + shape.dot.cy * h, shape.dot.r * h, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.restore()
      continue
    }
    if (ann.type === 'note') {
      if (comments) drawNoteIcon(ctx, ann.x * scale, ann.y * scale, ann.width * scale, ann.color)
      continue
    }

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

/** A highlight is laid on with Multiply, so the text under it stays black. */
export function drawMarkup(
  ctx: CanvasRenderingContext2D,
  type: 'highlight' | 'underline' | 'strikeout',
  color: string,
  rects: { x: number; y: number; width: number; height: number }[],
  scale: number,
): void {
  ctx.save()
  if (type === 'highlight') {
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = color
    for (const r of rects) ctx.fillRect(r.x * scale, r.y * scale, r.width * scale, r.height * scale)
  } else {
    ctx.strokeStyle = color
    for (const r of rects) {
      const y = (r.y + r.height * (type === 'underline' ? 0.9 : 0.55)) * scale
      ctx.lineWidth = Math.max(0.5, r.height * 0.07) * scale
      ctx.beginPath()
      ctx.moveTo(r.x * scale, y)
      ctx.lineTo((r.x + r.width) * scale, y)
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** The note icon as the saved PDF draws it: a folded-corner sheet. */
export function drawNoteIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const s = size, k = s / 20
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = color
  ctx.strokeStyle = '#404040'
  ctx.lineWidth = 0.8 * k
  ctx.beginPath()
  ctx.moveTo(k, k); ctx.lineTo(s - 6 * k, k); ctx.lineTo(s - k, 6 * k); ctx.lineTo(s - k, s - k); ctx.lineTo(k, s - k); ctx.closePath()
  ctx.fill(); ctx.stroke()
  ctx.lineWidth = 0.6 * k
  ctx.beginPath()
  for (const f of [0.38, 0.55, 0.72]) { ctx.moveTo(4 * k, s * f); ctx.lineTo(s - 4 * k, s * f) }
  ctx.stroke()
  ctx.restore()
}
