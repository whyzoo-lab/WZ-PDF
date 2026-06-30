// src/services/hwpDocAdapter.ts
import type { HwpDocument } from '@rhwp/core'
import type { ViewerDoc, ViewerPage, ViewerViewport } from '../types/viewerDoc'

/**
 * Adapt rhwp's HwpDocument to the pdfjs-shaped ViewerDoc the app consumes.
 * rhwp pages are 0-based; pdfjs/the app are 1-based — translate at the boundary.
 */
export function createHwpViewerDoc(doc: HwpDocument): ViewerDoc {
  const naturalCache = new Map<number, ViewerViewport>()

  /** Scale-1 page size, measured once via a throwaway probe render and cached. */
  function natural(idx0: number): ViewerViewport {
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
    getPage: async (pageNumber: number): Promise<ViewerPage> => {
      const idx0 = pageNumber - 1
      return {
        getViewport: ({ scale }) => {
          const n = natural(idx0)
          return { width: n.width * scale, height: n.height * scale }
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
