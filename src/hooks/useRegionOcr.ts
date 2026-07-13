import { useState, useRef, useEffect, useCallback } from 'react'
import type Konva from 'konva'
import { toStoredCoords } from '../utils/coordinates'
import type { ActiveMode } from '../types/annotation'
import type { PageData } from './usePdfPage'

type Region = { x: number; y: number; w: number; h: number }
type PointerEvt = Konva.KonvaEventObject<MouseEvent | TouchEvent>

/**
 * Ctrl+drag a region in view/select mode → OCR that crop → hand the recognized
 * text back (the caller copies it to the clipboard). A transient highlighter
 * rectangle, stored in PDF points. Mouse + Ctrl only, so it never interferes
 * with normal clicks or touch. The window-mouseup net handles drags that end
 * off the Stage (e.g. on the gray margin).
 *
 * `onDown`/`onMove` no-op unless the Ctrl+drag gesture is active, so callers can
 * invoke them unconditionally alongside the drawing handlers.
 */
export function useRegionOcr(
  pageData: PageData | null,
  effectiveZoom: number,
  activeMode: ActiveMode,
  isDrawing: boolean,
  onRegionCopy: ((text: string) => void) | undefined,
) {
  const [region, setRegion] = useState<Region | null>(null)
  const regionRef = useRef<Region | null>(null)
  const [regionBusy, setRegionBusy] = useState(false)

  const getPointerStored = (e: PointerEvt): { x: number; y: number } | null => {
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()
    if (!pos) return null
    return toStoredCoords(pos.x, pos.y, effectiveZoom)
  }

  const finish = useCallback(() => {
    const r = regionRef.current
    regionRef.current = null
    setRegion(null)
    if (!r || !pageData || !onRegionCopy) return
    const x = Math.min(r.x, r.x + r.w), y = Math.min(r.y, r.y + r.h)
    const w = Math.abs(r.w), h = Math.abs(r.h)
    if (w < 6 || h < 6) return   // ignore tiny drags / stray Ctrl-clicks
    const s = pageData.renderScale
    const sw = Math.max(1, Math.round(w * s)), sh = Math.max(1, Math.round(h * s))
    const crop = document.createElement('canvas')
    crop.width = sw; crop.height = sh
    crop.getContext('2d')?.drawImage(pageData.canvas, Math.round(x * s), Math.round(y * s), sw, sh, 0, 0, sw, sh)
    setRegionBusy(true)
    void (async () => {
      try {
        const { predict } = await import('../services/ocrEngine')
        const lines = await predict(crop)
        onRegionCopy(lines.map(l => l.text).join(' ').replace(/\s+/g, ' ').trim())
      } catch {
        onRegionCopy('')
      } finally {
        setRegionBusy(false)
        crop.width = 0; crop.height = 0
      }
    })()
  }, [pageData, onRegionCopy])

  useEffect(() => {
    if (!region) return
    window.addEventListener('mouseup', finish)
    return () => window.removeEventListener('mouseup', finish)
  }, [region, finish])

  // Active only in view/select mode (not while a markup tool is selected) and
  // only for mouse + Ctrl, so it never interferes with normal clicks or touch.
  const regionTrigger = (e: PointerEvt) =>
    !isDrawing && !!onRegionCopy && (activeMode === null || activeMode === 'select') &&
    e.evt instanceof MouseEvent && e.evt.ctrlKey

  const onDown = (e: PointerEvt) => {
    if (!regionTrigger(e)) return
    const p = getPointerStored(e)
    if (!p) return
    const r: Region = { x: p.x, y: p.y, w: 0, h: 0 }
    regionRef.current = r; setRegion(r)
  }

  const onMove = (e: PointerEvt) => {
    const r = regionRef.current
    if (!r) return
    const p = getPointerStored(e)
    if (!p) return
    const next: Region = { x: r.x, y: r.y, w: p.x - r.x, h: p.y - r.y }
    regionRef.current = next; setRegion(next)
  }

  return { region, regionBusy, onDown, onMove, finish }
}
