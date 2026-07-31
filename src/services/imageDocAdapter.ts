// src/services/imageDocAdapter.ts
//
// Adapt a bitmap (jpg / png / bmp / gif / webp …) to the pdfjs-shaped ViewerDoc.
//
// An image is page-like in the way a message is not: fixed geometry, one "page",
// no reflow. So rather than building a separate image viewer, we present it as a
// one-page document — and zoom, rotation, fit, annotations, print and every
// export (PDF / images ZIP / HTML) then work through the paths they already use,
// with no branching downstream.

import type { ViewerDoc, ViewerPage } from '../types/viewerDoc'

/** Anything with fixed pixel dimensions that canvas can draw in one call. */
type Drawable = ImageBitmap | HTMLImageElement

function sizeOf(src: Drawable): { width: number; height: number } {
  return src instanceof HTMLImageElement
    ? { width: src.naturalWidth, height: src.naturalHeight }
    : { width: src.width, height: src.height }
}

/**
 * Decode image bytes.
 *
 * `createImageBitmap` is the primary path: it is Promise-based, so unlike
 * `new Image()` + onload it resolves even when the page is not being painted
 * (a background/occluded window) — the same trap that made HWP pictures look
 * broken before. The <img> fallback exists only for engines without it.
 */
async function decode(bytes: ArrayBuffer, mimeType: string): Promise<Drawable> {
  const blob = new Blob([bytes], { type: mimeType || 'application/octet-stream' })
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob)
    } catch { /* unsupported format for this engine — try the <img> decoder */ }
  }
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Unsupported or corrupt image'))
      img.src = url
    })
  } finally {
    // The element keeps its decoded pixels; the object URL is no longer needed.
    URL.revokeObjectURL(url)
  }
}

/** Wrap image bytes as a single-page ViewerDoc. */
export async function createImageViewerDoc(
  bytes: ArrayBuffer,
  mimeType: string,
): Promise<ViewerDoc> {
  const source = await decode(bytes, mimeType)
  const natural = sizeOf(source)
  if (!natural.width || !natural.height) throw new Error('Image has no dimensions')

  const page: ViewerPage = {
    getViewport: ({ scale }) => ({
      width: natural.width * scale,
      height: natural.height * scale,
      scale,
    }),
    render: ({ canvas, viewport }) => {
      // Match the caller's requested raster size, then paint the whole bitmap
      // into it — the browser does the resampling.
      canvas.width = Math.max(1, Math.round(viewport.width))
      canvas.height = Math.max(1, Math.round(viewport.height))
      const ctx = canvas.getContext('2d')
      if (!ctx) return { promise: Promise.resolve() }
      // A photo scaled down looks noticeably better with smoothing on, and it
      // costs nothing for the 1:1 case.
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
      return { promise: Promise.resolve() }
    },
    // No text in a bitmap. OCR (Ctrl+drag, or the OCR button) is the way to get
    // text out, and it already works off the rendered canvas.
    getTextContent: async () => ({ items: [] }),
  }

  return {
    numPages: 1,
    getPage: async () => page,
    destroy: () => {
      if (!(source instanceof HTMLImageElement)) source.close()
    },
  }
}
