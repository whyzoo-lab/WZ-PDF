import { useState, useRef, useEffect, useCallback } from 'react'
import type Konva from 'konva'
import { toStoredCoords } from '../utils/coordinates'
import { PEN_COLOR, PEN_STROKE_WIDTH, PEN_OPACITY, RECT_COLOR, RECT_STROKE_WIDTH } from '../utils/markupConstants'
import type { ActiveMode, OmitId, Annotation } from '../types/annotation'

type PenDraw  = { kind: 'pen'; points: number[] }
type RectDraw = { kind: 'rect'; x: number; y: number; w: number; h: number }
export type PageDraft = PenDraw | RectDraw
type PointerEvt = Konva.KonvaEventObject<MouseEvent | TouchEvent>

/**
 * Volatile markup drawing (yellow pen / red rectangle). Owns the in-progress
 * draft (in PDF points, so it scales during in-flight zoom) and commits it as a
 * real annotation on release. Includes the window-level mouseup safety net that
 * catches drags whose release lands off the originating Stage (spread mode).
 *
 * Returns `onDown`/`onMove`/`commit` handlers that no-op unless a pen/rectangle
 * tool is active — so callers can invoke them unconditionally.
 */
export function usePageDrawing(
  activeMode: ActiveMode,
  pageNumber: number,
  effectiveZoom: number,
  onAnnotationAdd: (annotation: OmitId<Annotation>) => void,
) {
  const [draft, setDraft] = useState<PageDraft | null>(null)
  const draftRef = useRef<PageDraft | null>(null)

  const getPointerStored = (e: PointerEvt): { x: number; y: number } | null => {
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()
    if (!pos) return null
    return toStoredCoords(pos.x, pos.y, effectiveZoom)
  }

  const commit = useCallback(() => {
    const d = draftRef.current
    if (!d) return
    draftRef.current = null
    setDraft(null)
    if (d.kind === 'pen') {
      if (d.points.length >= 4) {
        onAnnotationAdd({
          type: 'pen',
          page: pageNumber,
          x: 0, y: 0, width: 0, height: 0,
          rotation: 0,
          points: d.points,
          color: PEN_COLOR,
          strokeWidth: PEN_STROKE_WIDTH,
          opacity: PEN_OPACITY,
        })
      }
    } else {
      const nx = d.w < 0 ? d.x + d.w : d.x
      const ny = d.h < 0 ? d.y + d.h : d.y
      const nw = Math.abs(d.w)
      const nh = Math.abs(d.h)
      if (nw > 2 && nh > 2) {
        onAnnotationAdd({
          type: 'rectangle',
          page: pageNumber,
          x: nx, y: ny, width: nw, height: nh,
          rotation: 0,
          color: RECT_COLOR,
          strokeWidth: RECT_STROKE_WIDTH,
        })
      }
    }
  }, [pageNumber, onAnnotationAdd])

  // Window-level mouseup safety net: in spread mode the cursor often crosses
  // from one page's Stage to the other (or to gray margin) before release,
  // which means the originating Stage never sees mouseup and the stroke is
  // orphaned. Listening on window guarantees we always commit on release.
  useEffect(() => {
    const isDrawingNow = activeMode === 'pen' || activeMode === 'rectangle'
    if (!isDrawingNow) return
    const onUp = () => commit()
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [activeMode, commit])

  const onDown = (e: PointerEvt) => {
    if (activeMode === 'pen') {
      const p = getPointerStored(e)
      if (!p) return
      const next: PenDraw = { kind: 'pen', points: [p.x, p.y] }
      draftRef.current = next
      setDraft(next)
    } else if (activeMode === 'rectangle') {
      const p = getPointerStored(e)
      if (!p) return
      const next: RectDraw = { kind: 'rect', x: p.x, y: p.y, w: 0, h: 0 }
      draftRef.current = next
      setDraft(next)
    }
  }

  const onMove = (e: PointerEvt) => {
    const d = draftRef.current
    if (!d) return
    const p = getPointerStored(e)
    if (!p) return
    if (d.kind === 'pen') {
      const next: PenDraw = { kind: 'pen', points: [...d.points, p.x, p.y] }
      draftRef.current = next
      setDraft(next)
    } else {
      const next: RectDraw = { kind: 'rect', x: d.x, y: d.y, w: p.x - d.x, h: p.y - d.y }
      draftRef.current = next
      setDraft(next)
    }
  }

  return { draft, onDown, onMove, commit }
}
