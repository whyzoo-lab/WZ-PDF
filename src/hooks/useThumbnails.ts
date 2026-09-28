import { useState, useEffect, useRef, useCallback, type RefObject } from 'react'
import type { ViewerDoc } from '../types/viewerDoc'
import { PDF_RENDER_SCALE } from '../utils/constants'
import { peekCachedPage } from '../services/pageRender'

/** 썸네일 렌더링 배율 (PDF_RENDER_SCALE * 0.2 = 약 90px 너비) */
const THUMBNAIL_SCALE = 0.2

/** Attribute each row of the list carries, holding its 1-based page number. */
export const THUMB_PAGE_ATTR = 'data-thumb-page'

// Per document, so closing and reopening the panel — it unmounts on close —
// does not render every page again.
const thumbCache = new WeakMap<ViewerDoc, Map<number, string>>()

function cacheFor(doc: ViewerDoc): Map<number, string> {
  let m = thumbCache.get(doc)
  if (!m) { m = new Map(); thumbCache.set(doc, m) }
  return m
}

async function renderThumbnail(doc: ViewerDoc, pageNumber: number): Promise<string> {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE * THUMBNAIL_SCALE })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  // A page already rasterised for the viewer only needs shrinking — no second
  // trip through the pdfjs worker, which the pages on screen are waiting on.
  const raster = peekCachedPage(doc, pageNumber)
  const ctx = raster ? canvas.getContext('2d') : null
  if (raster && ctx) {
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(raster.canvas, 0, 0, canvas.width, canvas.height)
  } else {
    await page.render({ canvas, viewport }).promise
  }
  return canvas.toDataURL('image/jpeg', 0.8)
}

/**
 * Page thumbnails for the page panel, rendered only for the rows that are in
 * (or near) view in `listRef`, and cached per document.
 *
 * It used to render every page in order the moment the panel opened. On a
 * long document that was all of it through the worker before the reader asked
 * for any of it; on a PDF over 500 MB, paged in by range, it pulled in the
 * whole file; and each finished page copied the whole array, re-rendering
 * every row — quadratic over the run.
 *
 * Rows mark themselves with `THUMB_PAGE_ATTR`. Returns the thumbnail for a
 * page, or null while it has not been rendered.
 */
export function useThumbnails(
  pdfDoc: ViewerDoc | null,
  numPages: number,
  listRef: RefObject<HTMLElement | null>,
): (page: number) => string | null {
  // Bumped when a thumbnail lands, so the panel re-reads the cache.
  const [, setVersion] = useState(0)
  const wanted = useRef(new Set<number>())
  const running = useRef<ViewerDoc | null>(null)

  const pump = useCallback(async (doc: ViewerDoc) => {
    if (running.current === doc) return
    running.current = doc
    try {
      const cache = cacheFor(doc)
      while (running.current === doc && wanted.current.size > 0) {
        const [page] = wanted.current
        wanted.current.delete(page)
        if (cache.has(page)) continue
        try {
          cache.set(page, await renderThumbnail(doc, page))
          if (running.current === doc) setVersion(v => v + 1)
        } catch (err) {
          // A document replaced mid-render (another file, an undo of a page
          // edit) fails its pending renders; that is not worth reporting.
          if (running.current === doc) console.error(`[useThumbnails] page ${page} 렌더링 실패:`, err)
        }
      }
    } finally {
      if (running.current === doc) running.current = null
    }
  }, [])

  useEffect(() => {
    const list = listRef.current
    if (!pdfDoc || !list || numPages === 0) return
    const queue = wanted.current // one Set for the hook's life
    queue.clear()
    const cache = cacheFor(pdfDoc)
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const page = Number((entry.target as HTMLElement).getAttribute(THUMB_PAGE_ATTR))
        if (!page || cache.has(page)) continue
        // Scrolled past before its turn: not worth rendering after all.
        if (entry.isIntersecting) queue.add(page)
        else queue.delete(page)
      }
      void pump(pdfDoc)
    }, { root: list, rootMargin: '300px 0px' })
    list.querySelectorAll(`[${THUMB_PAGE_ATTR}]`).forEach(row => observer.observe(row))
    return () => {
      observer.disconnect()
      queue.clear()
      running.current = null
    }
  }, [pdfDoc, numPages, listRef, pump])

  return useCallback((page: number) => (pdfDoc ? thumbCache.get(pdfDoc)?.get(page) ?? null : null), [pdfDoc])
}
