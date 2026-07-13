// src/services/hwpDocAdapter.ts
import type { HwpDocument } from '@rhwp/core'
import type { ViewerDoc, ViewerPage, HwpTextRun } from '../types/viewerDoc'

/** One run as emitted by rhwp's getPageTextLayout JSON. */
interface RhwpRun { text: string; x: number; y: number; w: number; h: number }

/** A decoded embedded picture from rhwp's page layer tree. bbox is in scale-1
 *  page pixels (same space as renderPageToCanvas at scale 1). */
interface LayerImage {
  x: number; y: number; width: number; height: number
  rotation: number; horzFlip: boolean; vertFlip: boolean
  img: HTMLImageElement
}

/**
 * Adapt rhwp's HwpDocument to the pdfjs-shaped ViewerDoc the app consumes.
 * rhwp pages are 0-based; pdfjs/the app are 1-based — translate at the boundary.
 */
export function createHwpViewerDoc(doc: HwpDocument): ViewerDoc {
  const naturalCache = new Map<number, { width: number; height: number }>()
  // Decoded embedded images per page (bbox + base64 don't change with zoom, so
  // decode once; only the draw scale varies per render).
  const imageCache = new Map<number, Promise<LayerImage[]>>()

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

  function loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise(resolve => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = src
    })
  }

  /**
   * rhwp's renderPageToCanvas does NOT paint embedded pictures (its
   * getPageOverlayImages returns them empty), so logos / header bands / any
   * inserted image are missing from the canvas. getPageLayerTree, however,
   * carries each image with its page-space bbox + base64 bytes. Extract and
   * decode them once per page so we can composite them on top after the text
   * render.
   */
  function loadPageImages(idx0: number): Promise<LayerImage[]> {
    const hit = imageCache.get(idx0)
    if (hit) return hit
    const promise = (async (): Promise<LayerImage[]> => {
      // Cheap gate: skip the (large) layer-tree parse for image-free pages.
      try {
        const overlay = JSON.parse(doc.getPageOverlayImages(idx0)) as { imageCount?: number }
        if (overlay && overlay.imageCount === 0) return []
      } catch { /* fall through to the layer tree */ }

      let tree: unknown
      try { tree = JSON.parse(doc.getPageLayerTree(idx0)) } catch { return [] }

      const nodes: Array<{ bbox?: { x: number; y: number; width: number; height: number }; mime?: string; base64?: string; transform?: { rotation?: number; horzFlip?: boolean; vertFlip?: boolean } }> = []
      const walk = (n: unknown): void => {
        if (Array.isArray(n)) { n.forEach(walk); return }
        if (n && typeof n === 'object') {
          const o = n as Record<string, unknown>
          if (o.type === 'image' && typeof o.base64 === 'string' && o.bbox) nodes.push(o as (typeof nodes)[number])
          for (const k in o) walk(o[k])
        }
      }
      walk(tree)

      const out: LayerImage[] = []
      for (const n of nodes) {
        if (!n.bbox || !n.base64) continue
        const img = await loadImage(`data:${n.mime || 'image/png'};base64,${n.base64}`)
        if (!img) continue
        const t = n.transform ?? {}
        out.push({
          x: n.bbox.x, y: n.bbox.y, width: n.bbox.width, height: n.bbox.height,
          rotation: t.rotation ?? 0, horzFlip: !!t.horzFlip, vertFlip: !!t.vertFlip,
          img,
        })
      }
      return out
    })()
    imageCache.set(idx0, promise)
    return promise
  }

  /** Paint the page's embedded pictures onto the already-text-rendered canvas. */
  async function compositeImages(idx0: number, canvas: HTMLCanvasElement, scale: number): Promise<void> {
    const images = await loadPageImages(idx0)
    if (images.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    for (const im of images) {
      const dx = im.x * scale, dy = im.y * scale, dw = im.width * scale, dh = im.height * scale
      if (im.rotation || im.horzFlip || im.vertFlip) {
        ctx.save()
        ctx.translate(dx + dw / 2, dy + dh / 2)
        if (im.rotation) ctx.rotate((im.rotation * Math.PI) / 180)
        ctx.scale(im.horzFlip ? -1 : 1, im.vertFlip ? -1 : 1)
        ctx.drawImage(im.img, -dw / 2, -dh / 2, dw, dh)
        ctx.restore()
      } else {
        ctx.drawImage(im.img, dx, dy, dw, dh)
      }
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
          // shapes (sync). It omits embedded pictures, so composite those on top
          // (async — the picture bytes are decoded from the layer tree).
          doc.renderPageToCanvas(idx0, canvas, viewport.scale)
          return { promise: compositeImages(idx0, canvas, viewport.scale) }
        },
        getTextContent: async () => ({ items: [] }),
      }
    },
  }
}
