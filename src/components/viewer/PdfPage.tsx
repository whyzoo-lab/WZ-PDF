import { memo, useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { Stage, Layer, Image as KonvaImage, Line, Rect } from 'react-konva'
import type Konva from 'konva'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { usePdfPage } from '../../hooks/usePdfPage'
import { AnnotationLayer } from '../annotations/AnnotationLayer'
import { PdfTextLayer } from './PdfTextLayer'
import type { TextLayerHighlight } from './PdfTextLayer'
import { OcrTextLayer } from './OcrTextLayer'
import type { OcrPageResult } from '../../types/ocr'
import type { Annotation, ActiveMode, OmitId } from '../../types/annotation'
import { annotationsForPage } from '../../types/annotation'
import type { AppMode } from '../../types/viewModes'
import { toStoredCoords } from '../../utils/coordinates'
import { PDF_RENDER_SCALE } from '../../utils/constants'

// Visual constants for volatile markups
const PEN_COLOR        = '#FFFF00'
const PEN_STROKE_WIDTH = 14   // PDF points → renders ~21px at zoom=1
const PEN_OPACITY      = 0.4
const RECT_COLOR        = '#FF0000'
const RECT_STROKE_WIDTH = 2   // PDF points

interface PdfPageProps {
  pdfDoc: PDFDocumentProxy
  pageNumber: number
  zoom: number
  rotation?: number  // 0 | 90 | 180 | 270 (degrees, clockwise)
  appMode?: AppMode
  annotations: Annotation[]
  selectedId: string | null
  activeMode: ActiveMode
  pendingStamp: { src: string; presetId?: string } | null
  pendingSignature: string | null
  onAnnotationSelect: (id: string | null) => void
  onAnnotationUpdate: (id: string, updates: Partial<Annotation>) => void
  onAnnotationAdd: (annotation: OmitId<Annotation>) => void
  /** Search hits to highlight on this page (single-view search). */
  searchHighlights?: TextLayerHighlight[]
  ocrResult?: OcrPageResult
}

function PdfPageInner({
  pdfDoc,
  pageNumber,
  zoom,
  rotation = 0,
  appMode = 'viewer',
  annotations,
  selectedId,
  activeMode,
  pendingStamp,
  pendingSignature,
  onAnnotationSelect,
  onAnnotationUpdate,
  onAnnotationAdd,
  searchHighlights,
  ocrResult,
}: PdfPageProps) {
  const { pageData, isLoading } = usePdfPage(pdfDoc, pageNumber)

  // ── Drawing state for volatile markups (pen / rectangle) ─────────────────────
  // Stored in PDF points so it scales naturally during in-flight zoom.
  // Hooks must be declared before any early return, so we keep state + the
  // commit fn + the window-level mouseup safety net all here at the top.
  type PenDraw  = { kind: 'pen'; points: number[] }
  type RectDraw = { kind: 'rect'; x: number; y: number; w: number; h: number }
  const [draft, setDraft] = useState<PenDraw | RectDraw | null>(null)
  const draftRef = useRef<PenDraw | RectDraw | null>(null)

  // Commit the in-progress draft as a real annotation. Reused by Stage's
  // own onMouseUp and the window-level safety net below.
  const commitDraft = useCallback(() => {
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
    const onUp = () => commitDraft()
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [activeMode, commitDraft])

  // Memoized per-page filter so AnnotationLayer keeps a stable prop reference
  // when unrelated annotations change.
  const pageAnnotations = useMemo(
    () => annotationsForPage(annotations, pageNumber),
    [annotations, pageNumber],
  )

  const isRotated90 = rotation === 90 || rotation === 270

  if (isLoading || !pageData) {
    // Swap placeholder w/h when rotated 90/270
    const pw = isRotated90 ? 800 * zoom : 600 * zoom
    const ph = isRotated90 ? 600 * zoom : 800 * zoom
    return (
      <div
        style={{ width: pw, height: ph }}
        className="bg-gray-100 animate-pulse flex items-center justify-center"
      >
        <span className="text-gray-400 text-sm">Loading page {pageNumber}…</span>
      </div>
    )
  }

  // When rotation is 90 or 270, the displayed width/height swap.
  const renderedW = pageData.width * zoom
  const renderedH = pageData.height * zoom
  const stageWidth  = isRotated90 ? renderedH : renderedW
  const stageHeight = isRotated90 ? renderedW : renderedH
  const effectiveZoom = PDF_RENDER_SCALE * zoom

  // CSS transform: rotate around centre and then shift back so top-left aligns.
  // translateX/Y shift compensates for the origin moving during rotation.
  const rotationStyle: React.CSSProperties = rotation === 0 ? {} : {
    transform: `rotate(${rotation}deg)`,
    transformOrigin: 'top left',
    // After rotating, translate so the element stays in its layout box.
    ...(rotation === 90  && { transform: `rotate(90deg) translateY(-${renderedH}px)` }),
    ...(rotation === 180 && { transform: `rotate(180deg) translate(-${renderedW}px, -${renderedH}px)` }),
    ...(rotation === 270 && { transform: `rotate(270deg) translateX(-${renderedW}px)` }),
  }

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent | Event>) => {
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()

    if (pos && activeMode === 'stamp' && pendingStamp) {
      const stored = toStoredCoords(pos.x, pos.y, effectiveZoom)
      onAnnotationAdd({
        type: 'stamp',
        page: pageNumber,
        x: stored.x - 50,
        y: stored.y - 20,
        width: 100,
        height: 40,
        rotation: 0,
        src: pendingStamp.src,
        presetId: pendingStamp.presetId,
      })
      return
    }

    if (pos && activeMode === 'signature' && pendingSignature) {
      const stored = toStoredCoords(pos.x, pos.y, effectiveZoom)
      onAnnotationAdd({
        type: 'signature',
        page: pageNumber,
        x: stored.x - 75,
        y: stored.y - 25,
        width: 150,
        height: 50,
        rotation: 0,
        src: pendingSignature,
      })
      return
    }

    if (e.target === stage) {
      onAnnotationSelect(null)
    }
  }

  const cursor =
    (activeMode === 'stamp' && pendingStamp) ||
    (activeMode === 'signature' && pendingSignature) ||
    activeMode === 'pen' ||
    activeMode === 'rectangle'
      ? 'crosshair'
      : 'default'

  // ── Drawing handlers (pen / rectangle) ─────────────────────────────────────
  // Mouse and touch both go through the same handlers; Konva normalizes the
  // pointer position via stage.getPointerPosition(), so the event payload only
  // matters for the stage reference.
  type PointerEvt = Konva.KonvaEventObject<MouseEvent | TouchEvent>
  const getPointerStored = (e: PointerEvt): { x: number; y: number } | null => {
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()
    if (!pos) return null
    return toStoredCoords(pos.x, pos.y, effectiveZoom)
  }

  const handleMouseDown = (e: PointerEvt) => {
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

  const handleMouseMove = (e: PointerEvt) => {
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

  const handleMouseUp = commitDraft

  const isDrawing = activeMode === 'pen' || activeMode === 'rectangle'

  // The outer div holds the layout box (swapped dimensions for 90/270).
  // The inner Stage is rendered at the original orientation and rotated via CSS.
  return (
    <div style={{ width: stageWidth, height: stageHeight, overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, ...rotationStyle }}>
        <Stage
          width={renderedW}
          height={renderedH}
          onClick={handleStageClick}
          onTap={handleStageClick}
          onMouseDown={isDrawing ? handleMouseDown : undefined}
          onMouseMove={isDrawing ? handleMouseMove : undefined}
          onMouseUp={isDrawing ? handleMouseUp : undefined}
          // Touch equivalents — same handlers; Konva normalizes pointer position.
          onTouchStart={isDrawing ? handleMouseDown : undefined}
          onTouchMove={isDrawing ? handleMouseMove : undefined}
          onTouchEnd={isDrawing ? handleMouseUp : undefined}
          style={{ cursor }}
        >
          <Layer>
            <KonvaImage
              image={pageData.canvas}
              x={0}
              y={0}
              width={renderedW}
              height={renderedH}
            />
          </Layer>
          <AnnotationLayer
            annotations={pageAnnotations}
            selectedId={selectedId}
            effectiveZoom={effectiveZoom}
            stageWidth={renderedW}
            stageHeight={renderedH}
            onSelect={onAnnotationSelect}
            onUpdate={onAnnotationUpdate}
          />
          {/* In-progress drawing preview */}
          {draft && (
            <Layer listening={false}>
              {draft.kind === 'pen' ? (
                <Line
                  points={draft.points.map(p => p * effectiveZoom)}
                  stroke={PEN_COLOR}
                  strokeWidth={PEN_STROKE_WIDTH * effectiveZoom}
                  opacity={PEN_OPACITY}
                  lineCap="round"
                  lineJoin="round"
                  tension={0.3}
                />
              ) : (
                <Rect
                  x={(draft.w < 0 ? draft.x + draft.w : draft.x) * effectiveZoom}
                  y={(draft.h < 0 ? draft.y + draft.h : draft.y) * effectiveZoom}
                  width={Math.abs(draft.w) * effectiveZoom}
                  height={Math.abs(draft.h) * effectiveZoom}
                  stroke={RECT_COLOR}
                  strokeWidth={RECT_STROKE_WIDTH * effectiveZoom}
                  fill="transparent"
                />
              )}
            </Layer>
          )}
        </Stage>
      </div>

      {/* Selectable text overlay — shown when no tool is active (so it doesn't
          steal drag events from drawing/placement tools), OR whenever there are
          search highlights to render on this page.
          In editor mode, double-clicking a text span opens an edit prompt
          and creates a text-patch annotation. */}
      {(activeMode === null || activeMode === 'select' || (searchHighlights && searchHighlights.length > 0)) && (
        <PdfTextLayer
          pdfDoc={pdfDoc}
          pageNumber={pageNumber}
          scale={effectiveZoom}
          rotation={rotation}
          width={stageWidth}
          height={stageHeight}
          highlights={searchHighlights}
          onEditCommit={appMode === 'editor' ? (edit) => {
            onAnnotationAdd({
              type: 'textEdit',
              page: pageNumber,
              x: edit.x,
              y: edit.y,
              width: edit.width,
              height: edit.height,
              rotation: 0,
              text: edit.text,
              fontSize: edit.fontSize,
              color: '#000000',
              background: '#FFFFFF',
            })
          } : undefined}
        />
      )}
      {ocrResult && ocrResult.words.length > 0 && (
        <OcrTextLayer
          words={ocrResult.words}
          scale={effectiveZoom}
          width={stageWidth}
          height={stageHeight}
          highlights={searchHighlights}
        />
      )}
    </div>
  )
}

// React.memo with default shallow compare — skips re-renders when only
// unrelated state in App changes (e.g. modal toggles).
export const PdfPage = memo(PdfPageInner)
