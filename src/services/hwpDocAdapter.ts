// src/services/hwpDocAdapter.ts
import type { HwpDocument } from '@rhwp/core'
import type { ViewerDoc, ViewerPage, HwpTextRun } from '../types/viewerDoc'

/** One run as emitted by rhwp's getPageTextLayout JSON. */
interface RhwpRun { text: string; x: number; y: number; w: number; h: number }

/**
 * Adapt rhwp's HwpDocument to the pdfjs-shaped ViewerDoc the app consumes.
 * rhwp pages are 0-based; pdfjs/the app are 1-based — translate at the boundary.
 */
export function createHwpViewerDoc(doc: HwpDocument): ViewerDoc {
  const naturalCache = new Map<number, { width: number; height: number }>()

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
          // renderPageToCanvas sizes the canvas to page×scale and paints (sync).
          doc.renderPageToCanvas(idx0, canvas, viewport.scale)
          return { promise: Promise.resolve() }
        },
        getTextContent: async () => ({ items: [] }),
      }
    },
  }
}
