// Pictures of a PDF's pages for the in-app print preview (PrintPreviewModal).
//
// Word, PowerPoint, sheets, Markdown and mail print their text, not page
// pictures, so there is nothing rendered to show before the dialog. The
// desktop app makes the very PDF that would be printed (officeJobToPdf) and
// shows its pages here; the printer still gets the text, not these pictures.

import { getPdfWorkerUrl } from './pdfjsWorker'

/** Width the preview strip shows a page at, at most (it is ~3xl wide). */
const PREVIEW_WIDTH_PX = 1100
const PREVIEW_JPEG_QUALITY = 0.9

/** Each page as a JPEG Blob URL, in order. The caller revokes them. */
export async function renderPdfPreview(
  bytes: Uint8Array,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = getPdfWorkerUrl()
  const base = new URL('./', document.baseURI)
  // The viewer's own options (usePdfDocument.ts): FontFace off because it can
  // hang in Electron, and the decoders, fonts and CMaps it then needs.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    wasmUrl: new URL('wasm/', base).href,
    standardFontDataUrl: new URL('standard_fonts/', base).href,
    cMapUrl: new URL('cmaps/', base).href,
    cMapPacked: true,
  })
  const urls: string[] = []
  try {
    const doc = await task.promise
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const unit = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(2, PREVIEW_WIDTH_PX / unit.width) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('2d context unavailable')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      // 'print': display rendering paces itself with requestAnimationFrame,
      // which never fires while the window is hidden.
      await page.render({ canvas, viewport, intent: 'print' }).promise
      page.cleanup()
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', PREVIEW_JPEG_QUALITY))
      canvas.width = 0
      if (!blob) throw new Error('page image could not be encoded')
      urls.push(URL.createObjectURL(blob))
      onProgress?.(n, doc.numPages)
    }
    return urls
  } catch (err) {
    urls.forEach(url => URL.revokeObjectURL(url))
    throw err
  } finally {
    void task.destroy()
  }
}
