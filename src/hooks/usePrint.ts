import { useCallback, useEffect, useState } from 'react'
import type { ViewerDoc } from '../types/viewerDoc'
import type { Annotation } from '../types/annotation'
import { drawAnnotations, loadImage } from '../services/annotationCanvas'
import { nextFrame } from '../services/htmlPrint'
import { t } from '../i18n'
import { errorMessage } from '../utils/errors'

/**
 * Print render scale, independent of the on-screen render scale.
 *
 * The cached canvas in `usePdfPage` is rendered at 1.5x (≈108 DPI) — fine for
 * the display, blurry on paper. Re-render fresh at 2.5x for print (≈180 DPI
 * baseline, scaled up further by the printer driver) so output matches what
 * Chrome's built-in PDF viewer produces.
 *
 * Tradeoff: each A4 canvas is ~3.1M pixels (~12 MB raw RGBA) at this scale.
 * For very large documents (100+ pages) this still fits in a typical
 * browser's memory because images are serialized to JPEG (~500 KB each).
 */
const PRINT_RENDER_SCALE = 2.5
const PRINT_JPEG_QUALITY = 0.98  // higher than display because text is unforgiving

interface UsePrintArgs {
  pdfDoc: ViewerDoc | null
  numPages: number
  annotations: Annotation[]
  /** Where a failure is reported (the toast). */
  onError: (message: string) => void
}

/**
 * Composite a single page + its annotations onto a fresh canvas and return it
 * as an object URL for the preview and the print container.
 *
 * Volatile annotations (pen / rectangle) are skipped — they mirror the PDF
 * export semantics and never leave the screen.
 */
async function renderPageWithAnnotations(
  pdfDoc: ViewerDoc,
  pageNumber: number,
  annotations: Annotation[],
): Promise<string> {
  // Re-render the page fresh at print scale instead of reusing the cached
  // on-screen canvas — that one is at PDF_RENDER_SCALE (1.5x) and prints fuzzy.
  const page = await pdfDoc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: PRINT_RENDER_SCALE })
  const out = document.createElement('canvas')
  out.width = viewport.width
  out.height = viewport.height
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  await page.render({ canvas: out, viewport }).promise
  // Annotation coordinates are in PDF points; the canvas is at print scale —
  // or below it, where a very large picture capped its raster.
  await drawAnnotations(ctx, annotations, pageNumber, PRINT_RENDER_SCALE * (out.width / viewport.width))
  // Paper is white: a transparent picture's empty pixels would otherwise be
  // encoded black by the JPEG below.
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.globalCompositeOperation = 'source-over'

  // A Blob URL, not a data URL: `toBlob` encodes off the main thread, and a
  // 200-page document held as base64 strings was several hundred MB of JS
  // heap. The URLs are revoked when the preview closes.
  const blob = await new Promise<Blob | null>(resolve => out.toBlob(resolve, 'image/jpeg', PRINT_JPEG_QUALITY))
  out.width = 0 // release the full-size bitmap now rather than at GC
  if (!blob) throw new Error('page image could not be encoded')
  return URL.createObjectURL(blob)
}

/**
 * Print every page of the loaded PDF, with annotations composited in.
 *
 * Why we don't reuse the on-screen canvases:
 *   - `LazyPdfPage` only mounts pages near the viewport, so most pages have
 *     no canvas in the DOM when Print fires → mostly-blank preview.
 *
 * Approach:
 *   1. Iterate page 1..N, building a list of fully-composited <img> elements.
 *   2. Drop them into a single `#wz-print-root` container under <body>.
 *   3. Toggle `data-wz-printing` on <body> so the print CSS hides the app
 *      shell and shows only the print root.
 *   4. Call window.print() (web AND desktop — Electron's Chromium shows the
 *      same rich print-preview UI as a browser, so we use it everywhere).
 *   5. Clean up after the print dialog closes.
 *
 * `isPrinting` is exposed so the UI can show a "준비 중..." overlay because
 * generating images for an 80-page document still takes a few seconds.
 */
export function usePrint({ pdfDoc, numPages, annotations, onError }: UsePrintArgs) {
  const [isPrinting, setIsPrinting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  // Composited page images (Blob URLs) awaiting the in-app preview. Non-null ⇒
  // the preview modal is open. We show our own WYSIWYG preview because Electron
  // ships without Chrome's print preview, so window.print() there only opens the
  // bare OS dialog ("이 앱은 인쇄 미리 보기를 지원하지 않습니다").
  const [previewPages, setPreviewPages] = useState<string[] | null>(null)

  // Build every page (page + annotations) into a JPEG, then open the
  // preview. Printing itself happens on confirm.
  const handlePrint = useCallback(async () => {
    if (!pdfDoc || numPages === 0) return
    setIsPrinting(true)
    setProgress({ done: 0, total: numPages })
    try {
      // Sequential so cache lookups stay cheap and progress feels responsive;
      // parallel would saturate memory on large documents.
      const pages: string[] = []
      for (let p = 1; p <= numPages; p++) {
        pages.push(await renderPageWithAnnotations(pdfDoc, p, annotations))
        setProgress({ done: p, total: numPages })
      }
      setPreviewPages(pages)
    } catch (err) {
      console.error('[print] failed:', err)
      onError(t('print.prepareFailed', { error: errorMessage(err) }))
    } finally {
      setIsPrinting(false)
      setProgress({ done: 0, total: 0 })
    }
  }, [pdfDoc, numPages, annotations, onError])

  const cancelPrint = useCallback(() => setPreviewPages(null), [])

  // The preview's page images are Blob URLs; each set is released when it is
  // replaced or closed (printed, cancelled, or the app unmounts).
  useEffect(() => () => { previewPages?.forEach(url => URL.revokeObjectURL(url)) }, [previewPages])

  // Send the already-composited pages to the printer. Mounts them into the
  // hidden `#wz-print-root` (the print CSS shows only that) and calls
  // window.print(); cleans up after the dialog closes.
  const confirmPrint = useCallback(async () => {
    const pages = previewPages
    if (!pages || pages.length === 0) return
    let root: HTMLDivElement | null = null
    try {
      // Decode all images before printing so the dialog never captures blanks.
      const images = await Promise.all(pages.map(loadImage))
      root = document.createElement('div')
      root.id = 'wz-print-root'
      images.forEach(img => { img.setAttribute('data-wz-print', ''); root!.appendChild(img) })
      document.body.appendChild(root)
      document.body.setAttribute('data-wz-printing', '')

      // One frame so the print stylesheet applies before the dialog opens —
      // bounded, because rAF never fires while the window is occluded.
      await nextFrame()

      // window.print() returns after the dialog closes, which our cleanup relies on.
      window.print()
    } catch (err) {
      console.error('[print] failed:', err)
      onError(t('print.failed', { error: errorMessage(err) }))
    } finally {
      document.body.removeAttribute('data-wz-printing')
      root?.remove()
      setPreviewPages(null)
    }
  }, [previewPages, onError])

  useEffect(() => {
    const onPrint = () => { handlePrint() }
    document.addEventListener('wz-print', onPrint)
    return () => document.removeEventListener('wz-print', onPrint)
  }, [handlePrint])

  return { handlePrint, isPrinting, printProgress: progress, previewPages, confirmPrint, cancelPrint }
}
