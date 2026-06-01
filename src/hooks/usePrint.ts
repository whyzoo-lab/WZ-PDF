import { useCallback, useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Annotation } from '../types/annotation'
import { annotationsForPage } from '../types/annotation'
import { getOrRenderPage } from './usePdfPage'

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
  pdfDoc: PDFDocumentProxy | null
  numPages: number
  annotations: Annotation[]
}

/** Resolves once the image is decoded; rejects if the data URL is invalid. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

/**
 * Composite a single PDF page + its annotations onto a fresh canvas and
 * return it as an HTMLImageElement ready for the print container.
 *
 * Reuses the module-level page render cache, so pages the user has already
 * scrolled past are instant. Pages that were lazy-deferred get rendered on
 * demand from pdfjs.
 *
 * Volatile annotations (pen / rectangle) are intentionally skipped — they
 * mirror the PDF export semantics and never leave the screen.
 */
async function renderPageWithAnnotations(
  pdfDoc: PDFDocumentProxy,
  pageNumber: number,
  annotations: Annotation[],
): Promise<HTMLImageElement> {
  // Re-render the page fresh at print scale instead of reusing the cached
  // on-screen canvas — that one is at PDF_RENDER_SCALE (1.5x) and prints fuzzy.
  // `getOrRenderPage` is still called so other view code's cache stays warm,
  // but the bytes we paint are the high-res ones.
  await getOrRenderPage(pdfDoc, pageNumber)
  const page = await pdfDoc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: PRINT_RENDER_SCALE })
  const out = document.createElement('canvas')
  out.width = viewport.width
  out.height = viewport.height
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  await page.render({ canvas: out, viewport }).promise

  // Annotation coordinates are in PDF points; multiply by the same scale to
  // match the freshly-rendered canvas pixel grid.
  const scale = PRINT_RENDER_SCALE

  const pageAnnotations = annotationsForPage(annotations, pageNumber)

  for (const ann of pageAnnotations) {
    if (ann.type === 'pen' || ann.type === 'rectangle') continue  // volatile

    if (ann.type === 'stamp' || ann.type === 'signature') {
      try {
        const img = await loadImage(ann.src)
        const cx = (ann.x + ann.width / 2) * scale
        const cy = (ann.y + ann.height / 2) * scale
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate((ann.rotation * Math.PI) / 180)
        ctx.drawImage(
          img,
          -(ann.width / 2) * scale,
          -(ann.height / 2) * scale,
          ann.width * scale,
          ann.height * scale,
        )
        ctx.restore()
      } catch (err) {
        console.error('[print] failed to draw annotation image:', err)
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

  return loadImage(out.toDataURL('image/jpeg', PRINT_JPEG_QUALITY))
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
export function usePrint({ pdfDoc, numPages, annotations }: UsePrintArgs) {
  const [isPrinting, setIsPrinting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  const handlePrint = useCallback(async () => {
    if (!pdfDoc || numPages === 0) return
    setIsPrinting(true)
    setProgress({ done: 0, total: numPages })

    let root: HTMLDivElement | null = null
    try {
      // Build images sequentially so cache lookups stay cheap and progress
      // updates feel responsive. Parallel would saturate memory.
      const images: HTMLImageElement[] = []
      for (let p = 1; p <= numPages; p++) {
        const img = await renderPageWithAnnotations(pdfDoc, p, annotations)
        img.setAttribute('data-wz-print', '')
        images.push(img)
        setProgress({ done: p, total: numPages })
      }

      // Mount the print container
      root = document.createElement('div')
      root.id = 'wz-print-root'
      images.forEach(img => root!.appendChild(img))
      document.body.appendChild(root)
      document.body.setAttribute('data-wz-printing', '')

      // Give the browser one frame to apply the print stylesheet
      await new Promise(r => requestAnimationFrame(() => r(null)))

      // Always use window.print() — the renderer's Chromium gives us the rich
      // Chrome print-preview UI in both the web build AND Electron. We used to
      // route through electronAPI.printWindow → webContents.print() in the
      // desktop build, but that opens the OS *system* print dialog (no real
      // preview on Windows) and ignored some of our print CSS. window.print()
      // is synchronous-ish — it returns after the dialog closes, which is what
      // our cleanup code below depends on.
      window.print()
    } catch (err) {
      console.error('[print] failed:', err)
      alert(`인쇄 준비 실패: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      document.body.removeAttribute('data-wz-printing')
      root?.remove()
      setIsPrinting(false)
      setProgress({ done: 0, total: 0 })
    }
  }, [pdfDoc, numPages, annotations])

  useEffect(() => {
    const onPrint = () => { handlePrint() }
    document.addEventListener('wz-print', onPrint)
    return () => document.removeEventListener('wz-print', onPrint)
  }, [handlePrint])

  return { handlePrint, isPrinting, printProgress: progress }
}
