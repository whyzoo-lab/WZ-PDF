import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib'
import type { Annotation, WatermarkAnnotation } from '../types/annotation'
import { toPdfLibY, hexToRgb } from '../utils/coordinates'
import { PDF_RENDER_SCALE } from '../utils/constants'

/** Exported for unit testing */
export function base64ToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function exportPdf(
  originalBytes: ArrayBuffer,
  annotations: Annotation[],
): Promise<Blob> {
  const pdfDoc = await PDFDocument.load(originalBytes)
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const pages = pdfDoc.getPages()

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx]
    const pageNum = pageIdx + 1
    const { width: pdfPageWidth, height: pdfPageHeight } = page.getSize()

    const pageAnnotations = annotations.filter(a =>
      a.type === 'watermark'
        ? (a as WatermarkAnnotation).allPages || a.page === pageNum
        : a.page === pageNum,
    )

    for (const annotation of pageAnnotations) {
      if (annotation.type === 'stamp' || annotation.type === 'signature') {
        // Stored coords are in rendered pixel space → divide by PDF_RENDER_SCALE to get PDF points
        const pdfX = annotation.x / PDF_RENDER_SCALE
        const pdfYTop = annotation.y / PDF_RENDER_SCALE
        const pdfW = annotation.width / PDF_RENDER_SCALE
        const pdfH = annotation.height / PDF_RENDER_SCALE
        const pdfLibY = toPdfLibY(pdfYTop, pdfH, pdfPageHeight)

        const bytes = base64ToUint8Array((annotation as any).src)
        const image = await pdfDoc.embedPng(bytes)
        page.drawImage(image, {
          x: pdfX,
          y: pdfLibY,
          width: pdfW,
          height: pdfH,
          rotate: degrees(annotation.rotation),
        })
      }

      if (annotation.type === 'watermark') {
        const wm = annotation as WatermarkAnnotation
        const [r, g, b] = hexToRgb(wm.color)
        const textWidth = helvetica.widthOfTextAtSize(wm.text, wm.fontSize)
        page.drawText(wm.text, {
          x: (pdfPageWidth - textWidth) / 2,
          y: pdfPageHeight / 2 - wm.fontSize / 2,
          size: wm.fontSize,
          font: helvetica,
          color: rgb(r, g, b),
          opacity: wm.opacity,
          rotate: degrees(wm.rotation),
        })
      }
    }
  }

  const pdfBytes = await pdfDoc.save()
  return new Blob([pdfBytes], { type: 'application/pdf' })
}
