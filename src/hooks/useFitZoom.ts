import { useCallback, useEffect } from 'react'
import type { ViewerDoc } from '../types/viewerDoc'
import type { ViewMode } from '../types/viewModes'
import { MAX_ZOOM, PDF_RENDER_SCALE } from '../utils/constants'

interface UseFitZoomArgs {
  pdfDoc: ViewerDoc | null
  viewMode: ViewMode
  rotation: number
  setZoom: (zoom: number) => void
}

/**
 * Auto-fit: pick the largest zoom level where the page (or two pages, in
 * spread mode) fits inside the viewport. Only applies to `single` and
 * `spread` modes — grid uses a fixed scale and fullscreen manages its own.
 *
 * Triggers whenever the doc, view mode, or rotation changes, debounced
 * by 80 ms so the surrounding layout has settled before measurement.
 */
export function useFitZoom({ pdfDoc, viewMode, rotation, setZoom }: UseFitZoomArgs) {
  const calcFitZoom = useCallback(async (
    doc: ViewerDoc,
    mode: ViewMode,
    rot: number,
  ) => {
    try {
      const page = await doc.getPage(1)
      const vp = page.getViewport({ scale: PDF_RENDER_SCALE })
      const isRotated90 = rot === 90 || rot === 270
      const pageW = isRotated90 ? vp.height : vp.width
      const pageH = isRotated90 ? vp.width  : vp.height

      const ACTION_BAR_H = 44
      const SCROLLBAR   = 18
      const isSpread = mode === 'spread'
      const V_PAD = isSpread ? 32 : 48
      const H_PAD = isSpread ? 16 : 32
      const availW = window.innerWidth  - H_PAD - SCROLLBAR
      const availH = window.innerHeight - ACTION_BAR_H - V_PAD

      let fitZoom = isSpread
        ? Math.min(availW / (pageW * 2), availH / pageH)
        : Math.min(availW / pageW, availH / pageH)
      fitZoom = Math.floor(fitZoom * 100) / 100
      fitZoom = Math.max(0.1, Math.min(MAX_ZOOM, fitZoom))
      setZoom(fitZoom)
    } catch (err) {
      console.error('Auto-fit zoom failed:', err)
    }
  }, [setZoom])

  useEffect(() => {
    if (!pdfDoc) return
    if (viewMode !== 'single' && viewMode !== 'spread') return
    const t = setTimeout(() => calcFitZoom(pdfDoc, viewMode, rotation), 80)
    return () => clearTimeout(t)
  }, [pdfDoc, viewMode, rotation, calcFitZoom])

  return { calcFitZoom }
}
