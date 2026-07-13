// src/services/hwpDocAdapter.ts
import type { HwpDocument } from '@rhwp/core'
import type { ViewerDoc, ViewerPage, HwpTextRun } from '../types/viewerDoc'

/** One run as emitted by rhwp's getPageTextLayout JSON. */
interface RhwpRun { text: string; x: number; y: number; w: number; h: number }

interface Bbox { x: number; y: number; width: number; height: number }

/** Walk a getPageLayerTree JSON and return the first embedded-image bbox, if any.
 *  bbox is in scale-1 page px (same space as renderPageToCanvas at scale 1). */
function firstImageBbox(node: unknown): Bbox | null {
  if (Array.isArray(node)) {
    for (const n of node) { const b = firstImageBbox(n); if (b) return b }
    return null
  }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    if (o.type === 'image' && o.bbox && typeof o.bbox === 'object') {
      const b = o.bbox as Bbox
      if (typeof b.x === 'number' && typeof b.width === 'number') return b
    }
    for (const k in o) { if (k === 'base64') continue; const b = firstImageBbox(o[k]); if (b) return b }
  }
  return null
}

/** Fraction of non-(near-white) pixels in a canvas region. */
function paintedFraction(canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number): number {
  const ctx = canvas.getContext('2d')
  if (!ctx) return 1 // can't measure — assume painted so we don't spin
  const cx = Math.max(0, Math.min(canvas.width - 1, Math.round(x)))
  const cy = Math.max(0, Math.min(canvas.height - 1, Math.round(y)))
  const cw = Math.max(1, Math.min(canvas.width - cx, Math.round(w)))
  const ch = Math.max(1, Math.min(canvas.height - cy, Math.round(h)))
  const d = ctx.getImageData(cx, cy, cw, ch).data
  let c = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 10 && !(d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245)) c++
  }
  return c / (d.length / 4)
}

/**
 * Adapt rhwp's HwpDocument to the pdfjs-shaped ViewerDoc the app consumes.
 * rhwp pages are 0-based; pdfjs/the app are 1-based — translate at the boundary.
 */
export function createHwpViewerDoc(doc: HwpDocument): ViewerDoc {
  const naturalCache = new Map<number, { width: number; height: number }>()
  // Per-page embedded-image bbox (null = page has no picture), parsed once.
  const imageBboxCache = new Map<number, Bbox | null>()

  /** Scale-1 page size, measured once via a throwaway probe render and cached. */
  function natural(idx0: number): { width: number; height: number } {
    const hit = naturalCache.get(idx0)
    if (hit) return hit
    const probe = document.createElement('canvas')
    doc.renderPageToCanvas(idx0, probe, 1)           // sizes probe to page×1
    const vp = { width: probe.width, height: probe.height }
    probe.width = 0; probe.height = 0                // release
    naturalCache.set(idx0, vp)
    return vp
  }

  function imageBbox(idx0: number): Bbox | null {
    const hit = imageBboxCache.get(idx0)
    if (hit !== undefined) return hit
    let bbox: Bbox | null = null
    try { bbox = firstImageBbox(JSON.parse(doc.getPageLayerTree(idx0))) } catch { /* none */ }
    imageBboxCache.set(idx0, bbox)
    return bbox
  }

  /**
   * rhwp paints text/shapes AND embedded pictures (logos, header bands), but it
   * decodes those pictures ASYNCHRONOUSLY: a page's first render(s) within
   * ~200 ms of first touching that page paint the text but omit the image
   * (confirmed by pixel-sampling — 5 back-to-back renders all miss the logo, yet
   * one 200 ms later includes it; it is time-, not render-count-based, and the
   * decode is per-page). Without waiting, the app's first visible render drops
   * the picture. So after the initial render, if the page has an image that is
   * not yet painted, re-render in place until it appears (or a cap is hit). This
   * keeps rhwp's own single, correctly-positioned draw — NO getLayerTree
   * compositing, which would double-draw and produce a misplaced gray blob.
   */
  async function ensureImagePainted(idx0: number, canvas: HTMLCanvasElement, scale: number): Promise<void> {
    const bbox = imageBbox(idx0)
    if (!bbox) return // no picture on this page
    for (let i = 0; i < 18; i++) { // ≤ ~1.5 s, then give up gracefully
      if (paintedFraction(canvas, bbox.x * scale, bbox.y * scale, bbox.width * scale, bbox.height * scale) > 0.1) return
      await new Promise(r => setTimeout(r, 80))
      doc.renderPageToCanvas(idx0, canvas, scale) // re-render in place once decode advances
    }
  }

  return {
    numPages: doc.pageCount(),
    destroy: () => doc.free(),
    // Native positioned text (page-point coords = scale-1 px), so HWP text is
    // selectable/copyable without OCR. Empty runs (layout-only) are dropped.
    getPageText: async (pageNumber: number): Promise<HwpTextRun[]> => {
      const idx0 = pageNumber - 1
      try {
        const parsed = JSON.parse(doc.getPageTextLayout(idx0)) as { runs?: RhwpRun[] }
        return (parsed.runs ?? [])
          .filter(r => r.text && r.text.length > 0)
          .map(r => ({ text: r.text, x: r.x, y: r.y, width: r.w, height: r.h }))
      } catch {
        return []
      }
    },
    getPage: async (pageNumber: number): Promise<ViewerPage> => {
      const idx0 = pageNumber - 1
      return {
        getViewport: ({ scale }) => {
          const n = natural(idx0)
          return { width: n.width * scale, height: n.height * scale, scale }
        },
        render: ({ canvas, viewport }) => {
          // renderPageToCanvas sizes the canvas to page×scale and paints text /
          // shapes / pictures (sync). Pictures decode async, so poll a re-render
          // until the page's embedded image is actually painted.
          doc.renderPageToCanvas(idx0, canvas, viewport.scale)
          return { promise: ensureImagePainted(idx0, canvas, viewport.scale) }
        },
        getTextContent: async () => ({ items: [] }),
      }
    },
  }
}
