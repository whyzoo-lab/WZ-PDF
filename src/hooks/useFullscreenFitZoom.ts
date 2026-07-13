import { useState, useEffect, useCallback } from 'react'
import { PDF_RENDER_SCALE } from '../utils/constants'
import type { ViewerDoc } from '../types/viewerDoc'

interface FitZoomDeps {
  pdfDoc: ViewerDoc
  currentPage: number
  /** The right-hand page in spread layout, or null in single layout. */
  rightPage: number | null
  isRotated90: boolean
}

/**
 * Owns the fullscreen page zoom, auto-fitting the current page (or spread) to
 * the window on page/rotation/layout change and on resize. Returns the zoom and
 * its setter so the presenter key/wheel handlers can also nudge it.
 */
export function useFullscreenFitZoom({ pdfDoc, currentPage, rightPage, isRotated90 }: FitZoomDeps) {
  const [zoom, setZoom] = useState(1)

  const calcZoom = useCallback(() => {
    pdfDoc.getPage(currentPage).then(page => {
      const vp = page.getViewport({ scale: PDF_RENDER_SCALE })
      // Swap dimensions if rotated 90/270
      const pageW = isRotated90 ? vp.height : vp.width
      const pageH = isRotated90 ? vp.width : vp.height
      const pagesShown = rightPage !== null ? 2 : 1
      const totalW = pageW * pagesShown + (pagesShown > 1 ? 2 : 0)
      setZoom(Math.min(
        window.innerWidth  / totalW,
        window.innerHeight / pageH,
      ))
    }).catch(console.error)
  }, [pdfDoc, currentPage, rightPage, isRotated90])

  useEffect(() => { calcZoom() }, [calcZoom])
  useEffect(() => {
    window.addEventListener('resize', calcZoom)
    return () => window.removeEventListener('resize', calcZoom)
  }, [calcZoom])

  return { zoom, setZoom }
}
