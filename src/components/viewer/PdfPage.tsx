import { memo, useMemo, useState, useEffect } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type Konva from 'konva'
import { Stage, Layer, Image as KonvaImage, Line, Rect } from 'react-konva'
import type { ViewerDoc, DocKind } from '../../types/viewerDoc'
import { usePdfPage } from '../../hooks/usePdfPage'
import { usePageDrawing } from '../../hooks/usePageDrawing'
import { useRegionOcr } from '../../hooks/useRegionOcr'
import { useHwpPageText } from '../../hooks/useHwpPageText'
import { AnnotationLayer } from '../annotations/AnnotationLayer'
import { PdfTextLayer } from './PdfTextLayer'
import type { TextLayerHighlight, TextEditCommit } from './PdfTextLayer'
import { OcrTextLayer } from './OcrTextLayer'
import type { OcrPageResult } from '../../types/ocr'
import { t } from '../../i18n'
import type { Annotation, ActiveMode, OmitId } from '../../types/annotation'
import { annotationsForPage } from '../../types/annotation'
import type { AppMode } from '../../types/viewModes'
import { toStoredCoords } from '../../utils/coordinates'
import { PDF_RENDER_SCALE } from '../../utils/constants'
import { PEN_COLOR, PEN_STROKE_WIDTH, PEN_OPACITY, RECT_COLOR, RECT_STROKE_WIDTH } from '../../utils/markupConstants'
import { sampleBackgroundColor } from '../../utils/sampleBgColor'

type PointerEvt = Konva.KonvaEventObject<MouseEvent | TouchEvent>

interface PdfPageProps {
  pdfDoc: ViewerDoc
  /** Which engine produced the document — gates PDF-only features like PdfTextLayer. */
  kind: DocKind
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
  /** True while OCR is recognizing this page — shows the scanning animation. */
  ocrActive?: boolean
  /** Request OCR for this page (e.g. on double-click of an un-recognized page). */
  onOcrRequest?: (page: number) => void
  /** Ctrl+drag a region in view mode → OCR that crop → deliver the text (clipboard). */
  onRegionCopy?: (text: string) => void
}

function PdfPageInner({
  pdfDoc,
  kind,
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
  ocrActive,
  onOcrRequest,
  onRegionCopy,
}: PdfPageProps) {
  // Rasterize the page to match how big it's actually shown: logical scale ×
  // current zoom × the display's pixel density. Quantized (round up to 0.5) so
  // small zoom nudges don't re-render; capped by MAX_RENDER_SCALE inside the hook.
  // Zooming out keeps the higher-res canvas (the hook only upgrades), so this is
  // effectively "max scale shown so far".
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const desiredRenderScale = Math.ceil(PDF_RENDER_SCALE * zoom * dpr * 2) / 2
  const { pageData, isLoading } = usePdfPage(pdfDoc, pageNumber, desiredRenderScale)

  // Coordinate divisor (PDF points ↔ screen). Hoisted above the early return so
  // the input hooks below (which run before it) can convert pointer positions.
  // Depends only on `zoom` + a constant, never on pageData.
  const effectiveZoom = PDF_RENDER_SCALE * zoom
  const isDrawing = activeMode === 'pen' || activeMode === 'rectangle'

  // ── Input pipelines (hooks must precede the loading early-return) ──────────
  // Volatile pen/rectangle drawing.
  const drawing = usePageDrawing(activeMode, pageNumber, effectiveZoom, onAnnotationAdd)
  // Ctrl+drag region → OCR → clipboard (view mode).
  const region = useRegionOcr(pageData, effectiveZoom, activeMode, isDrawing, onRegionCopy)
  // HWP native selectable text (no OCR pass needed).
  const { hwpWords, hasHwpText } = useHwpPageText(pdfDoc, pageNumber, kind)

  // Origin point (CSS px, relative to the page box) for the OCR scanning
  // animation when it was kicked off by a triple-click. null → the default
  // top→bottom sweep (e.g. when triggered from the toolbar button).
  const [ocrOrigin, setOcrOrigin] = useState<{ x: number; y: number } | null>(null)
  // Drop the origin once recognition ends so the next run starts clean.
  useEffect(() => { if (!ocrActive) setOcrOrigin(null) }, [ocrActive])

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

  // Combined Stage pointer handlers: the drawing and region hooks each no-op
  // unless their own gesture is active (a draft and a region can never be active
  // at once — drawing needs a pen/rectangle tool, region needs view/select), so
  // invoking both is equivalent to the old draft-first `if/else if` dispatch.
  const onStageDown = (e: PointerEvt) => { drawing.onDown(e); region.onDown(e) }
  const onStageMove = (e: PointerEvt) => { drawing.onMove(e); region.onMove(e) }
  const onStageUp   = ()             => { drawing.commit(); region.finish() }

  // Shared by the pdfjs text layer and the OCR text layer: turn an inline text
  // edit into a `textEdit` annotation. The patch is filled with the region's
  // sampled background colour (not plain white) so it blends into coloured /
  // off-white / scanned paper; falls back to white if the canvas can't be read.
  const commitTextEdit = (edit: TextEditCommit) => {
    // Index into the canvas in its own pixel space: canvas px = PDF points ×
    // the scale the page was actually rasterized at (not the logical scale).
    const px = pageData.renderScale
    const background =
      sampleBackgroundColor(
        pageData.canvas,
        edit.x * px,
        edit.y * px,
        edit.width * px,
        edit.height * px,
      ) ?? '#FFFFFF'
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
      background,
    })
  }

  // Triple-click an un-recognized page (not while a drawing/placement tool is
  // active) to OCR it, with the scanning animation radiating from the click.
  // `event.detail` is the consecutive-click count, so the 3rd rapid click fires
  // a click event with detail === 3 — no manual timer needed.
  const handleTripleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.detail !== 3) return
    if (!onOcrRequest || ocrResult || ocrActive) return
    if (!(activeMode === null || activeMode === 'select')) return
    const rect = e.currentTarget.getBoundingClientRect()
    setOcrOrigin({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    onOcrRequest(pageNumber)
  }

  // The outer div holds the layout box (swapped dimensions for 90/270).
  // The inner Stage is rendered at the original orientation and rotated via CSS.
  return (
    <div
      onClick={handleTripleClick}
      style={{ width: stageWidth, height: stageHeight, overflow: 'hidden', position: 'relative' }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, ...rotationStyle }}>
        <Stage
          width={renderedW}
          height={renderedH}
          onClick={handleStageClick}
          onTap={handleStageClick}
          // Mouse handlers are always attached: they route to markup drawing or
          // Ctrl+drag region selection internally (and ignore plain clicks).
          onMouseDown={onStageDown}
          onMouseMove={onStageMove}
          onMouseUp={onStageUp}
          // Touch equivalents — markup only (region selection is mouse+Ctrl).
          onTouchStart={isDrawing ? drawing.onDown : undefined}
          onTouchMove={isDrawing ? drawing.onMove : undefined}
          onTouchEnd={isDrawing ? drawing.commit : undefined}
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
          {drawing.draft && (
            <Layer listening={false}>
              {drawing.draft.kind === 'pen' ? (
                <Line
                  points={drawing.draft.points.map(p => p * effectiveZoom)}
                  stroke={PEN_COLOR}
                  strokeWidth={PEN_STROKE_WIDTH * effectiveZoom}
                  opacity={PEN_OPACITY}
                  lineCap="round"
                  lineJoin="round"
                  tension={0.3}
                />
              ) : (
                <Rect
                  x={(drawing.draft.w < 0 ? drawing.draft.x + drawing.draft.w : drawing.draft.x) * effectiveZoom}
                  y={(drawing.draft.h < 0 ? drawing.draft.y + drawing.draft.h : drawing.draft.y) * effectiveZoom}
                  width={Math.abs(drawing.draft.w) * effectiveZoom}
                  height={Math.abs(drawing.draft.h) * effectiveZoom}
                  stroke={RECT_COLOR}
                  strokeWidth={RECT_STROKE_WIDTH * effectiveZoom}
                  fill="transparent"
                />
              )}
            </Layer>
          )}
          {/* Ctrl+drag region selection (yellow highlighter) */}
          {region.region && (
            <Layer listening={false}>
              <Rect
                x={(region.region.w < 0 ? region.region.x + region.region.w : region.region.x) * effectiveZoom}
                y={(region.region.h < 0 ? region.region.y + region.region.h : region.region.y) * effectiveZoom}
                width={Math.abs(region.region.w) * effectiveZoom}
                height={Math.abs(region.region.h) * effectiveZoom}
                fill={PEN_COLOR}
                opacity={0.3}
                stroke={PEN_COLOR}
                strokeWidth={1}
              />
            </Layer>
          )}
        </Stage>
      </div>

      {/* Region OCR busy badge */}
      {region.regionBusy && (
        <div className="wz-ocr-badge no-print" style={{ position: 'absolute', top: 8, left: 8 }}>
          <span className="wz-ocr-badge-dot" />
          {t('region.recognizing')}
        </div>
      )}

      {/* Selectable text overlay — shown when no tool is active (so it doesn't
          steal drag events from drawing/placement tools), OR whenever there are
          search highlights to render on this page.
          In editor mode, double-clicking a text span opens an edit prompt
          and creates a text-patch annotation. */}
      {kind === 'pdf' && (activeMode === null || activeMode === 'select' || (searchHighlights && searchHighlights.length > 0)) && (
        <PdfTextLayer
          pdfDoc={pdfDoc}
          pageNumber={pageNumber}
          scale={effectiveZoom}
          rotation={rotation}
          width={stageWidth}
          height={stageHeight}
          highlights={searchHighlights}
          onEditCommit={appMode === 'editor' ? commitTextEdit : undefined}
        />
      )}
      {/* HWP native selectable text — replaces OCR for HWP pages that carry text. */}
      {hasHwpText && (
        <OcrTextLayer
          words={hwpWords!}
          scale={effectiveZoom}
          width={stageWidth}
          height={stageHeight}
          highlights={searchHighlights}
          reveal={false}
        />
      )}
      {/* OCR text — skipped when HWP native text is already shown (avoids overlap). */}
      {!hasHwpText && ocrResult && ocrResult.words.length > 0 && (
        <OcrTextLayer
          words={ocrResult.words}
          scale={effectiveZoom}
          width={stageWidth}
          height={stageHeight}
          highlights={searchHighlights}
          onEditCommit={appMode === 'editor' ? commitTextEdit : undefined}
        />
      )}
      {/* Scanning animation while OCR recognizes this page. A triple-click
          origin radiates a ripple from the click; otherwise a top→bottom sweep. */}
      {ocrActive && (
        <div
          className="wz-ocr-scanning no-print"
          style={{ position: 'absolute', top: 0, left: 0, width: stageWidth, height: stageHeight }}
        >
          {ocrOrigin ? (
            <div className="wz-ocr-radial" style={{ left: ocrOrigin.x, top: ocrOrigin.y }} />
          ) : (
            <div className="wz-ocr-scanline" />
          )}
          <span className="wz-ocr-badge">
            <span className="wz-ocr-badge-dot" />
            {t('ocr.recognizing')}
          </span>
        </div>
      )}
    </div>
  )
}

// React.memo with default shallow compare — skips re-renders when only
// unrelated state in App changes (e.g. modal toggles).
export const PdfPage = memo(PdfPageInner)
