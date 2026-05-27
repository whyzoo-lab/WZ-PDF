import { useState, useEffect } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PDF_RENDER_SCALE } from '../utils/constants'

export interface PageData {
  canvas: HTMLCanvasElement  // rendered page canvas (Konva accepts this directly)
  width: number              // rendered pixel width (= PDF points * PDF_RENDER_SCALE)
  height: number             // rendered pixel height
}

interface UsePdfPageReturn {
  pageData: PageData | null
  isLoading: boolean
}

// ─── Module-level render cache ───────────────────────────────────────────────
// Pages are rendered ONCE per document and reused across view-mode transitions
// (single ↔ spread ↔ grid ↔ fullscreen) and StrictMode double-mounts.
// WeakMap keys: cache is automatically released when the PDFDocumentProxy is GC'd.
const pageCache = new WeakMap<PDFDocumentProxy, Map<number, PageData>>()
const inflightRenders = new WeakMap<PDFDocumentProxy, Map<number, Promise<PageData>>>()

function getCacheMap(doc: PDFDocumentProxy): Map<number, PageData> {
  let m = pageCache.get(doc)
  if (!m) { m = new Map(); pageCache.set(doc, m) }
  return m
}

function getInflightMap(doc: PDFDocumentProxy): Map<number, Promise<PageData>> {
  let m = inflightRenders.get(doc)
  if (!m) { m = new Map(); inflightRenders.set(doc, m) }
  return m
}

async function renderPage(pdfDoc: PDFDocumentProxy, pageNumber: number): Promise<PageData> {
  const page = await pdfDoc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(`canvas.getContext('2d') returned null for page ${pageNumber}`)
  await page.render({ canvas, viewport }).promise
  return { canvas, width: viewport.width, height: viewport.height }
}

/**
 * Render-or-fetch from cache. Concurrent calls for the same page de-duplicate
 * onto a single inflight promise.
 */
function getOrRender(pdfDoc: PDFDocumentProxy, pageNumber: number): Promise<PageData> {
  const cache = getCacheMap(pdfDoc)
  const hit = cache.get(pageNumber)
  if (hit) return Promise.resolve(hit)

  const inflight = getInflightMap(pdfDoc)
  const pending = inflight.get(pageNumber)
  if (pending) return pending

  const p = renderPage(pdfDoc, pageNumber)
    .then(data => {
      cache.set(pageNumber, data)
      inflight.delete(pageNumber)
      return data
    })
    .catch(err => {
      inflight.delete(pageNumber)
      throw err
    })
  inflight.set(pageNumber, p)
  return p
}

export function usePdfPage(
  pdfDoc: PDFDocumentProxy | null,
  pageNumber: number,
): UsePdfPageReturn {
  // Synchronous cache hit on first render — avoids the loading flash when
  // re-mounting after a view-mode change.
  const [pageData, setPageData] = useState<PageData | null>(() => {
    if (!pdfDoc) return null
    return pageCache.get(pdfDoc)?.get(pageNumber) ?? null
  })
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!pdfDoc) { setPageData(null); return }

    // Cache hit: hand over the cached canvas synchronously, no loading state.
    const hit = pageCache.get(pdfDoc)?.get(pageNumber)
    if (hit) {
      setPageData(hit)
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setPageData(null)

    getOrRender(pdfDoc, pageNumber)
      .then(data => {
        if (cancelled) return
        setPageData(data)
        setIsLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        console.error(`Failed to render PDF page ${pageNumber}:`, err)
        setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [pdfDoc, pageNumber])

  return { pageData, isLoading }
}
