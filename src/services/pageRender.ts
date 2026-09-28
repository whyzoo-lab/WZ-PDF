// The page render cache. Not a hook: print, OCR and the exporters use it as
// well as the viewer, and a service importing from hooks/ had the layers the
// wrong way round.
import type { ViewerDoc } from '../types/viewerDoc'
import { PDF_RENDER_SCALE, MAX_RENDER_SCALE } from '../utils/constants'

export interface PageData {
  canvas: HTMLCanvasElement  // rendered page canvas (Konva accepts this directly)
  width: number              // LOGICAL width  (= PDF points * PDF_RENDER_SCALE) — display/coords
  height: number             // LOGICAL height (= PDF points * PDF_RENDER_SCALE)
  renderScale: number        // actual pixels-per-point of `canvas` (canvas.width = points * renderScale)
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

// ─── Bounding the cache ──────────────────────────────────────────────────────
// Nothing used to leave this cache until the document closed, and a raster is
// width × height × 4 bytes: ~3 MB per A4 page at fit-page, ~15 MB at fit-width,
// so reading a long document to the end held gigabytes. Pages are now evicted
// least-recently-used once the cache passes a byte budget — but never a page
// that is on screen (`retainPage`), whose canvas Konva is drawing. Eviction
// only drops the reference; a caller mid-way through using a canvas (OCR,
// print) keeps it alive until it is done.
let budgetBytes = 512 * 1024 * 1024
const pageRefs = new WeakMap<ViewerDoc, Map<number, number>>()
const lastUsed = new WeakMap<PageData, number>()
let useClock = 0

function touch(data: PageData): PageData {
  lastUsed.set(data, ++useClock)
  return data
}

function bytesOf(data: PageData): number {
  return data.canvas.width * data.canvas.height * 4
}

function evictOverBudget(doc: ViewerDoc): void {
  const cache = pageCache.get(doc)
  if (!cache) return
  let total = 0
  for (const data of cache.values()) total += bytesOf(data)
  if (total <= budgetBytes) return
  const refs = pageRefs.get(doc)
  const idle = [...cache].filter(([page]) => !refs?.get(page))
    .sort(([, a], [, b]) => (lastUsed.get(a) ?? 0) - (lastUsed.get(b) ?? 0))
  for (const [page, data] of idle) {
    if (total <= budgetBytes) break
    cache.delete(page)
    total -= bytesOf(data)
  }
}

/** A page is on screen: keep its raster cached until `releasePage`. */
export function retainPage(doc: ViewerDoc, pageNumber: number): void {
  let refs = pageRefs.get(doc)
  if (!refs) { refs = new Map(); pageRefs.set(doc, refs) }
  refs.set(pageNumber, (refs.get(pageNumber) ?? 0) + 1)
}

/** The page left the screen; its raster may now be evicted. */
export function releasePage(doc: ViewerDoc, pageNumber: number): void {
  const refs = pageRefs.get(doc)
  const n = (refs?.get(pageNumber) ?? 0) - 1
  if (n > 0) refs?.set(pageNumber, n)
  else refs?.delete(pageNumber)
  evictOverBudget(doc)
}

/** For tests: the byte budget, and back to the default with no argument. */
export function setPageCacheBudget(bytes = 512 * 1024 * 1024): void {
  budgetBytes = bytes
}

/** Peek the cached page (any resolution), used for synchronous mount-time hits. */
export function peekCachedPage(doc: ViewerDoc, pageNumber: number): PageData | null {
  const hit = pageCache.get(doc)?.get(pageNumber)
  return hit ? touch(hit) : null
}

// The raster may go BELOW the logical scale. Rasterising a page at 1.5 px/pt and
// then letting the compositor squeeze it into 0.6 px/pt of screen is what made
// small Korean glyphs look broken: a 2.4x reduction through canvas's default
// (low-quality) filter drops strokes. Rendering near the size actually shown
// lets the rasteriser antialias correctly instead. The floor only stops the
// value collapsing to something absurd on extreme zoom-out.
const MIN_RENDER_SCALE = 0.4

export function clampScale(scale: number): number {
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
  // The raster is what we keep. pdfjs also keeps everything it decoded to draw
  // it — every image on the page, as bitmaps — until told otherwise, and
  // across a long document that, not our canvases, was most of the memory.
  // Drawing the page again (a higher zoom) re-decodes, which is rare next to
  // scrolling. Not every ViewerDoc page has this (HWP, images).
  ;(page as { cleanup?: () => unknown }).cleanup?.()
  // Timing mark only; no-ops after the first page of each document.
  const { markOpen } = await import('./openPerf')
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

export function getOrRender(pdfDoc: ViewerDoc, pageNumber: number, minRenderScale: number): Promise<PageData> {
  const target = clampScale(minRenderScale)
  const cache = getCacheMap(pdfDoc)
  const hit = cache.get(pageNumber)
  if (hit && hit.renderScale >= target - 1e-3) return Promise.resolve(touch(hit))

  const inflight = getInflightMap(pdfDoc)
  const pending = inflight.get(pageNumber)
  if (pending && pending.scale >= target - 1e-3) return pending.p

  const p = renderPage(pdfDoc, pageNumber, target)
    .then(data => {
      // Only keep the highest-resolution result (renders may finish out of order).
      const cur = cache.get(pageNumber)
      if (!cur || data.renderScale >= cur.renderScale) cache.set(pageNumber, touch(data))
      if (inflight.get(pageNumber)?.p === p) inflight.delete(pageNumber)
      const result = cache.get(pageNumber) ?? data
      evictOverBudget(pdfDoc)
      return result
    })
    .catch(err => {
      if (inflight.get(pageNumber)?.p === p) inflight.delete(pageNumber)
      throw err
    })
  inflight.set(pageNumber, { p, scale: target })
  return p
}
