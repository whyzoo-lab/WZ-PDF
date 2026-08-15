import { useCallback, useEffect, type RefObject } from 'react'
import type { ViewerDoc } from '../types/viewerDoc'
import type { ViewMode } from '../types/viewModes'
import { MAX_ZOOM, PDF_RENDER_SCALE } from '../utils/constants'

interface UseFitZoomArgs {
  pdfDoc: ViewerDoc | null
  viewMode: ViewMode
  rotation: number
  setZoom: (zoom: number) => void
  /** The viewer's viewport (<main>), measured directly so the fit never depends
   *  on guesses about the toolbar height or whether the page panel is open. */
  viewportRef: RefObject<HTMLElement | null>
}

// Padding of the scroll container that lives inside <main> — these mirror the
// `py-6 px-4` classes on #pdf-single-container, and the tighter spread layout.
const V_PAD_SINGLE = 48
const H_PAD_SINGLE = 32
const V_PAD_SPREAD = 32
const H_PAD_SPREAD = 16
// Only used by the no-element fallback; a measured element already excludes it.
const SCROLLBAR = 18

/**
 * Auto-fit: pick the largest zoom level where the page (or two pages, in
 * spread mode) fits inside the viewport. Only applies to `single` and
 * `spread` modes — grid uses a fixed scale and fullscreen manages its own.
 *
 * Triggers whenever the doc, view mode, or rotation changes, debounced
 * by 80 ms so the surrounding layout has settled before measurement.
 */
export function useFitZoom({ pdfDoc, viewMode, rotation, setZoom, viewportRef }: UseFitZoomArgs) {
  /**
   * Measure the page and the space it has, in the units the zoom is expressed
   * in. Shared so "fit the page" and "fit the width" cannot drift apart on the
   * padding and rotation handling — the part that is easy to get subtly wrong.
   */
  const measure = useCallback(async (doc: ViewerDoc, mode: ViewMode, rot: number) => {
    const page = await doc.getPage(1)
    const vp = page.getViewport({ scale: PDF_RENDER_SCALE })
    const isRotated90 = rot === 90 || rot === 270
    const pageW = isRotated90 ? vp.height : vp.width
    const pageH = isRotated90 ? vp.width : vp.height

    const isSpread = mode === 'spread'
    const V_PAD = isSpread ? V_PAD_SPREAD : V_PAD_SINGLE
    const H_PAD = isSpread ? H_PAD_SPREAD : H_PAD_SINGLE

    const el = viewportRef.current
    const availW = (el ? el.clientWidth : window.innerWidth - SCROLLBAR) - H_PAD
    const availH = (el ? el.clientHeight : window.innerHeight - 49) - V_PAD
    return { pageW, pageH, availW, availH, isSpread }
  }, [viewportRef])

  /**
   * Fit the page width, the way a browser's PDF viewer opens a document.
   *
   * Worth having as an explicit action: fitting the whole page puts an A4 at
   * roughly 74 DPI in a default window, and at that size a Korean glyph stroke
   * is thinner than a pixel and can never render as solid black — measured, the
   * share of near-black pixels more than doubles at twice the size. Fitting the
   * width trades a vertical scrollbar for that sharpness, so it is offered
   * rather than imposed.
   */
  const fitWidth = useCallback(async () => {
    if (!pdfDoc) return
    try {
      const { pageW, availW, isSpread } = await measure(pdfDoc, viewMode, rotation)
      if (availW <= 0) return
      let zoom = availW / (isSpread ? pageW * 2 : pageW)
      zoom = Math.floor(zoom * 100) / 100
      setZoom(Math.max(0.1, Math.min(MAX_ZOOM, zoom)))
    } catch (err) {
      console.error('Fit-width zoom failed:', err)
    }
  }, [pdfDoc, viewMode, rotation, measure, setZoom])

  const calcFitZoom = useCallback(async (
    doc: ViewerDoc,
    mode: ViewMode,
    rot: number,
  ) => {
    try {
      // clientWidth/clientHeight exclude borders and any visible scrollbar, so
      // this tracks the toolbar, the page panel and the window automatically.
      // Deriving it from window.innerHeight minus a hard-coded toolbar height
      // over-estimated the free space by 5px, and a single-page document then
      // opened just tall enough to raise a scrollbar.
      const { pageW, pageH, availW, availH, isSpread } = await measure(doc, mode, rot)
      if (availW <= 0 || availH <= 0) return

      let fitZoom = isSpread
        ? Math.min(availW / (pageW * 2), availH / pageH)
        : Math.min(availW / pageW, availH / pageH)
      // Round DOWN to a whole percent: the zoom field shows integers, and
      // landing a hair above the true fit is exactly what raises a scrollbar.
      fitZoom = Math.floor(fitZoom * 100) / 100
      fitZoom = Math.max(0.1, Math.min(MAX_ZOOM, fitZoom))
      setZoom(fitZoom)
    } catch (err) {
      console.error('Auto-fit zoom failed:', err)
    }
  }, [setZoom, measure])

  useEffect(() => {
    if (!pdfDoc) return
    if (viewMode !== 'single' && viewMode !== 'spread') return
    const t = setTimeout(() => calcFitZoom(pdfDoc, viewMode, rotation), 80)
    return () => clearTimeout(t)
  }, [pdfDoc, viewMode, rotation, calcFitZoom])

  return { calcFitZoom, fitWidth }
}
