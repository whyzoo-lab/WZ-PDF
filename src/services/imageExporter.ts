/**
 * Image Export (ZIP)
 *
 * Renders every PDF page to a PNG at high resolution (scale 2×) using pdfjs,
 * then packages all pages into a single ZIP file via JSZip.
 *
 * Annotations are NOT included — the render comes directly from the PDF source.
 * To export annotated images, first "Download PDF" (annotated), then re-open
 * that PDF and use this export.
 */

import JSZip from 'jszip'
import type { ViewerDoc } from '../types/viewerDoc'
import { downloadBlob, stripPdfExt } from '../utils/download'

/** Render scale for exported images — 2× gives ~144 DPI equivalent. */
const EXPORT_SCALE = 2

/** Convert a canvas element to a PNG Blob. */
function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
      'image/png',
    )
  })
}

/**
 * Export all pages of a PDF as PNG images bundled in a ZIP file.
 *
 * @param pdfDoc      pdfjs PDFDocumentProxy
 * @param numPages    Total page count
 * @param filename    Source filename — used to derive file/folder names
 * @param onProgress  Called after each page is rendered: (current, total)
 */
export async function exportAsImages(
  pdfDoc: ViewerDoc,
  numPages: number,
  filename: string,
  onProgress?: (current: number, total: number) => void,
): Promise<void> {
  const baseName  = stripPdfExt(filename)
  const padWidth  = String(numPages).length   // e.g. 3 for 100+ pages
  const zip       = new JSZip()

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    onProgress?.(pageNum, numPages)

    const page     = await pdfDoc.getPage(pageNum)
    const viewport = { ...page.getViewport({ scale: EXPORT_SCALE }), scale: EXPORT_SCALE }

    const canvas    = document.createElement('canvas')
    canvas.width    = Math.round(viewport.width)
    canvas.height   = Math.round(viewport.height)

    await page.render({ canvas, viewport }).promise

    const blob      = await canvasToPngBlob(canvas)
    const padded    = String(pageNum).padStart(padWidth, '0')
    zip.file(`${baseName}_page_${padded}.png`, blob)
  }

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  downloadBlob(zipBlob, `${baseName}_images.zip`)
}
