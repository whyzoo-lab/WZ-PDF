import { useState, useEffect } from 'react'
import type { ViewerDoc } from '../types/viewerDoc'
import { PDF_RENDER_SCALE } from '../utils/constants'
import { clampScale, getOrRender, peekCachedPage, releasePage, retainPage, type PageData } from '../services/pageRender'

export type { PageData } from '../services/pageRender'

interface UsePdfPageReturn {
  pageData: PageData | null
  isLoading: boolean
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

  // On screen: its raster must not be evicted from the cache under it.
  useEffect(() => {
    if (!pdfDoc) return
    retainPage(pdfDoc, pageNumber)
    return () => releasePage(pdfDoc, pageNumber)
  }, [pdfDoc, pageNumber])

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
