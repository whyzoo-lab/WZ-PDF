import { useState, useEffect } from 'react'
import type { ViewerDoc } from '../types/viewerDoc'
import { PDF_RENDER_SCALE, MAX_RENDER_SCALE } from '../utils/constants'

export interface PageData {
  canvas: HTMLCanvasElement  // rendered page canvas (Konva accepts this directly)
  width: number              // LOGICAL width  (= PDF points * PDF_RENDER_SCALE) — display/coords
  height: number             // LOGICAL height (= PDF points * PDF_RENDER_SCALE)
  renderScale: number        // actual pixels-per-point of `canvas` (canvas.width = points * renderScale)
}

interface UsePdfPageReturn {
  pageData: PageData | null
  isLoading: boolean
}

// ─── Module-level render cache ───────────────────────────────────────────────
// Pages are rendered per document and reused across view-mode transitions
// (single ↔ spread ↔ grid ↔ fullscreen) and StrictMode double-mounts.
// The cached canvas is rasterized at `renderScale` pixels-per-point, decoupled
// from the logical (coordinate) size: a page shown bigger or on a HiDPI screen
// is re-rendered at a higher renderScale so it stays sharp. We only ever upgrade
// the cached scale (zooming out keeps the higher-res canvas and downsamples).
// WeakMap keys: cache is automatically released when the ViewerDoc is GC'd.
const pageCache = new WeakMap<ViewerDoc, Map<number, PageData>>()
const inflightRenders = new WeakMap<ViewerDoc, Map<number, { p: Promise<PageData>; scale: number }>>()

function getCacheMap(doc: ViewerDoc): Map<number, PageData> {
  let m = pageCache.get(doc)
  if (!m) { m = new Map(); pageCache.set(doc, m) }
  return m
}

function getInflightMap(doc: ViewerDoc): Map<number, { p: Promise<PageData>; scale: number }> {
  let m = inflightRenders.get(doc)
  if (!m) { m = new Map(); inflightRenders.set(doc, m) }
  return m
}

/** Peek the cached page (any resolution), used for synchronous mount-time hits. */
export function peekCachedPage(doc: ViewerDoc, pageNumber: number): PageData | null {
  return pageCache.get(doc)?.get(pageNumber) ?? null
}

// The raster may go BELOW the logical scale. Rasterising a page at 1.5 px/pt and
// then letting the compositor squeeze it into 0.6 px/pt of screen is what made
// small Korean glyphs look broken: a 2.4x reduction through canvas's default
// (low-quality) filter drops strokes. Rendering near the size actually shown
// lets the rasteriser antialias correctly instead. The floor only stops the
// value collapsing to something absurd on extreme zoom-out.
const MIN_RENDER_SCALE = 0.4

function clampScale(scale: number): number {
  return Math.min(MAX_RENDER_SCALE, Math.max(MIN_RENDER_SCALE, scale))
}

async function renderPage(pdfDoc: ViewerDoc, pageNumber: number, renderScale: number): Promise<PageData> {
  const page = await pdfDoc.getPage(pageNumber)
  // Logical viewport drives display size + the coordinate system; the raster
  // viewport drives the actual pixel resolution of the bitmap.
  const logical = page.getViewport({ scale: PDF_RENDER_SCALE })
  const raster = page.getViewport({ scale: renderScale })
  const canvas = document.createElement('canvas')
  canvas.width = raster.width
  canvas.height = raster.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(`canvas.getContext('2d') returned null for page ${pageNumber}`)
  await page.render({ canvas, viewport: raster }).promise
  // Timing mark only; no-ops after the first page of each document.
  const { markOpen } = await import('../services/openPerf')
  markOpen('first-page')
  return { canvas, width: logical.width, height: logical.height, renderScale }
}

/**
 * Render-or-fetch from cache at (at least) `minRenderScale` pixels-per-point.
 * A cached page at an equal-or-higher scale is reused; a lower-res cache is
 * upgraded by re-rendering. Concurrent calls de-duplicate onto a single
 * inflight promise (per page) as long as it targets a sufficient scale.
 * Exposed so non-React paths (print, OCR) can reuse the shared cache.
 */
export function getOrRenderPage(
  pdfDoc: ViewerDoc,
  pageNumber: number,
  minRenderScale: number = PDF_RENDER_SCALE,
): Promise<PageData> {
  return getOrRender(pdfDoc, pageNumber, minRenderScale)
}

function getOrRender(pdfDoc: ViewerDoc, pageNumber: number, minRenderScale: number): Promise<PageData> {
  const target = clampScale(minRenderScale)
  const cache = getCacheMap(pdfDoc)
  const hit = cache.get(pageNumber)
  if (hit && hit.renderScale >= target - 1e-3) return Promise.resolve(hit)

  const inflight = getInflightMap(pdfDoc)
  const pending = inflight.get(pageNumber)
  if (pending && pending.scale >= target - 1e-3) return pending.p

  const p = renderPage(pdfDoc, pageNumber, target)
    .then(data => {
      // Only keep the highest-resolution result (renders may finish out of order).
      const cur = cache.get(pageNumber)
      if (!cur || data.renderScale >= cur.renderScale) cache.set(pageNumber, data)
      if (inflight.get(pageNumber)?.p === p) inflight.delete(pageNumber)
      return cache.get(pageNumber) ?? data
    })
    .catch(err => {
      if (inflight.get(pageNumber)?.p === p) inflight.delete(pageNumber)
      throw err
    })
  inflight.set(pageNumber, { p, scale: target })
  return p
}

export function usePdfPage(
  pdfDoc: ViewerDoc | null,
  pageNumber: number,
  desiredRenderScale: number = PDF_RENDER_SCALE,
): UsePdfPageReturn {
  // Synchronous cache hit on first render — avoids the loading flash when
  // re-mounting after a view-mode change. Any cached resolution is shown
  // immediately; the effect upgrades it if a higher scale is now needed.
  const [pageData, setPageData] = useState<PageData | null>(() => {
    if (!pdfDoc) return null
    return peekCachedPage(pdfDoc, pageNumber)
  })
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // Reset when the document goes away — intentional effect-driven reset.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!pdfDoc) { setPageData(null); return }

    const target = clampScale(desiredRenderScale)
    const hit = peekCachedPage(pdfDoc, pageNumber)
    // Cache already meets the requested resolution: hand it over synchronously.
    if (hit && hit.renderScale >= target - 1e-3) {
      setPageData(hit)
      setIsLoading(false)
      return
    }

    let cancelled = false
    // Only show the loading skeleton when nothing is on screen yet. When we
    // already have a lower-res canvas, keep displaying it while the higher-res
    // render runs in the background, then swap — no blank flash on zoom-in.
    if (!hit) { setIsLoading(true); setPageData(null) }
    else setPageData(hit)

    getOrRender(pdfDoc, pageNumber, target)
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
  }, [pdfDoc, pageNumber, desiredRenderScale])

  return { pageData, isLoading }
}
