import { PDFDocument, PDFFont, rgb, degrees, StandardFonts } from 'pdf-lib'
import type { Annotation, WatermarkAnnotation } from '../types/annotation'
import { annotationsForPage } from '../types/annotation'
import { toPdfLibY, hexToRgb } from '../utils/coordinates'
import type { ViewerDoc } from '../types/viewerDoc'

/** Exported for unit testing */
export function base64ToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ── Korean font (lazy) ──────────────────────────────────────────────────────
// Helvetica covers only Latin-1; any CJK text drawn through it would silently
// fall back to glyph 0 (.notdef) and look broken in the exported PDF.
// We ship Noto Sans KR (OFL) and embed it via @pdf-lib/fontkit on demand.
//
// Fetched at most once per session and cached as a Uint8Array so repeated
// exports don't re-download. Vite serves it from /fonts/.

let _koFontBytes: Uint8Array | null = null
async function loadKoreanFontBytes(): Promise<Uint8Array> {
  if (_koFontBytes) return _koFontBytes
  // Vite sets `base: './'`, so a leading-slash URL resolves correctly under
  // any deployment path (root, sub-path, file://).
  const res = await fetch(new URL('./fonts/NotoSansKR-Regular.otf', document.baseURI))
  if (!res.ok) throw new Error(`Failed to load Korean font: ${res.status}`)
  _koFontBytes = new Uint8Array(await res.arrayBuffer())
  return _koFontBytes
}

/** True if any character is outside the Latin-1 supplement block — i.e. needs the CJK font. */
function needsKoreanFont(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0xFF) return true
  }
  return false
}

export async function exportPdf(
  originalBytes: ArrayBuffer,
  annotations: Annotation[],
): Promise<Blob> {
  const pdfDoc = await PDFDocument.load(originalBytes)
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)

  // Embed the Korean font lazily — only when a watermark or textEdit needs it.
  // Avoids the ~4MB fontkit + font overhead for stamps-only exports.
  let koFont: PDFFont | null = null
  const koNeeded = annotations.some(a =>
    (a.type === 'watermark' && needsKoreanFont(a.text)) ||
    (a.type === 'textEdit' && needsKoreanFont(a.text)),
  )
  if (koNeeded) {
    const { default: fontkit } = await import('@pdf-lib/fontkit')
    pdfDoc.registerFontkit(fontkit)
    const bytes = await loadKoreanFontBytes()
    koFont = await pdfDoc.embedFont(bytes, { subset: true })
  }
  const fontFor = (text: string): PDFFont =>
    needsKoreanFont(text) && koFont ? koFont : helvetica

  const pages = pdfDoc.getPages()

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx]
    const pageNum = pageIdx + 1
    const { width: pdfPageWidth, height: pdfPageHeight } = page.getSize()

    const pageAnnotations = annotationsForPage(annotations, pageNum)

    for (const annotation of pageAnnotations) {
      if (annotation.type === 'stamp' || annotation.type === 'signature') {
        // Stored coords are already PDF points (screen pixels / effectiveZoom, where effectiveZoom = PDF_RENDER_SCALE * zoom)
        const pdfX = annotation.x
        const pdfYTop = annotation.y
        const pdfW = annotation.width
        const pdfH = annotation.height
        const pdfLibY = toPdfLibY(pdfYTop, pdfH, pdfPageHeight)

        const bytes = base64ToUint8Array(annotation.src)
        try {
          const image = await pdfDoc.embedPng(bytes)
          page.drawImage(image, {
            x: pdfX,
            y: pdfLibY,
            width: pdfW,
            height: pdfH,
            rotate: degrees(annotation.rotation),
          })
        } catch (err) {
          console.error(`Failed to embed annotation image (id: ${annotation.id}):`, err)
        }
      }

      if (annotation.type === 'watermark') {
        const wm = annotation as WatermarkAnnotation
        const [r, g, b] = hexToRgb(wm.color)
        const font = fontFor(wm.text)
        const textWidth = font.widthOfTextAtSize(wm.text, wm.fontSize)
        page.drawText(wm.text, {
          x: (pdfPageWidth - textWidth) / 2,
          y: pdfPageHeight / 2 - wm.fontSize / 2,
          size: wm.fontSize,
          font,
          color: rgb(r, g, b),
          opacity: wm.opacity,
          rotate: degrees(wm.rotation),
        })
      }

      if (annotation.type === 'textEdit') {
        // Cover the original text with a filled rectangle, then draw the new
        // text on top. Coords stored top-left in PDF points; pdf-lib uses
        // bottom-left so we convert via toPdfLibY.
        const pdfLibY = toPdfLibY(annotation.y, annotation.height, pdfPageHeight)
        const [br, bg, bb] = hexToRgb(annotation.background)
        page.drawRectangle({
          x: annotation.x,
          y: pdfLibY,
          width: annotation.width,
          height: annotation.height,
          color: rgb(br, bg, bb),
        })
        const [fr, fg, fb] = hexToRgb(annotation.color)
        // Draw text baselined inside the box: pdf-lib's `y` is the baseline,
        // so offset upward by a fraction of fontSize to roughly vertically
        // centre. Empirical 0.2 works well for both Helvetica and Noto Sans KR.
        page.drawText(annotation.text, {
          x: annotation.x + 2,
          y: pdfLibY + annotation.height * 0.2,
          size: annotation.fontSize,
          font: fontFor(annotation.text),
          color: rgb(fr, fg, fb),
        })
      }
    }
  }

  const pdfBytes = await pdfDoc.save()
  // pdfBytes is a Uint8Array; BlobPart accepts it, but its backing buffer may
  // be a SharedArrayBuffer in some TS lib configs — cast to a plain Uint8Array
  // view to satisfy the BlobPart type without `any`.
  return new Blob([pdfBytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}

/**
 * Build a fresh PDF from a rendered HWP document by compositing each page
 * canvas with its non-volatile annotations.
 *
 * Because HWP bytes are not a PDF we can't load them into pdf-lib directly.
 * Instead we render every page via `getOrRenderPage`, draw the canvas as a
 * JPEG into a pdf-lib page sized to the canvas, and return the resulting bytes.
 * This doubles as an HWP → PDF converter.
 *
 * Volatile annotations (pen / rectangle) are intentionally skipped to match
 * the existing PDF export semantics.
 */
export async function exportHwpToPdf(
  doc: ViewerDoc,
  annotations: Annotation[],
): Promise<Uint8Array> {
  const { getOrRenderPage } = await import('../hooks/usePdfPage')

  const pdfDoc = await PDFDocument.create()

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const { canvas, renderScale } = await getOrRenderPage(doc, pageNum)

    // Composite non-volatile annotations onto a scratch canvas so the exported
    // page contains stamps/signatures/watermarks/textEdits just like print does.
    // `compositedCanvas` stays as `canvas` when 2d context is unavailable (e.g.
    // jsdom in tests); in real browsers it's always the annotated scratch canvas.
    let compositedCanvas: HTMLCanvasElement = canvas
    const out = document.createElement('canvas')
    out.width = canvas.width
    out.height = canvas.height
    const ctx = out.getContext('2d')
    if (ctx) {
      compositedCanvas = out
      ctx.drawImage(canvas, 0, 0)

      const pageAnnotations = annotationsForPage(annotations, pageNum)
      // Annotation coords are in PDF points; the canvas is at renderScale px/pt.
      const scale = renderScale

      for (const ann of pageAnnotations) {
        if (ann.type === 'pen' || ann.type === 'rectangle') continue  // volatile

        if (ann.type === 'stamp' || ann.type === 'signature') {
          try {
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
              const el = new Image()
              el.onload = () => resolve(el)
              el.onerror = () => reject(new Error('image load failed'))
              el.src = ann.src
            })
            const cx = (ann.x + ann.width / 2) * scale
            const cy = (ann.y + ann.height / 2) * scale
            ctx.save()
            ctx.translate(cx, cy)
            ctx.rotate((ann.rotation * Math.PI) / 180)
            ctx.drawImage(img, -(ann.width / 2) * scale, -(ann.height / 2) * scale, ann.width * scale, ann.height * scale)
            ctx.restore()
          } catch (err) {
            console.error('[hwp-export] failed to draw annotation image:', err)
          }
        } else if (ann.type === 'watermark') {
          ctx.save()
          ctx.font = `${ann.fontSize * scale}px sans-serif`
          ctx.fillStyle = ann.color
          ctx.globalAlpha = ann.opacity
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.translate(out.width / 2, out.height / 2)
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

    // Embed the composited canvas as JPEG into a pdf-lib page.
    const jpegDataUrl = compositedCanvas.toDataURL('image/jpeg', 0.92)
    const jpegBytes = base64ToUint8Array(jpegDataUrl)
    const jpegImage = await pdfDoc.embedJpg(jpegBytes)

    // Size the PDF page in PDF points (canvas pixels ÷ renderScale) so pdf-lib's
    // point-unit page matches the document's logical dimensions. The image is
    // drawn at the same point dimensions so it fills the page exactly.
    const pageWidth = compositedCanvas.width / renderScale
    const pageHeight = compositedCanvas.height / renderScale
    // Known limitation: dimensions are scale-1 pixel sizes used directly as PDF
    // points with no 96→72 DPI conversion, so the exported page's physical/print
    // size may differ from the source's true physical dimensions; visual proportions are correct.
    const page = pdfDoc.addPage([pageWidth, pageHeight])
    page.drawImage(jpegImage, { x: 0, y: 0, width: pageWidth, height: pageHeight })
  }

  return pdfDoc.save()
}
