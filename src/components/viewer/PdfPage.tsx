import { memo, useMemo, useRef, useState, useEffect, useCallback } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Stage, Layer, Image as KonvaImage, Line, Rect } from 'react-konva'
import type Konva from 'konva'
import type { ViewerDoc, DocKind } from '../../types/viewerDoc'
import { usePdfPage } from '../../hooks/usePdfPage'
import { AnnotationLayer } from '../annotations/AnnotationLayer'
import { PdfTextLayer } from './PdfTextLayer'
import type { TextLayerHighlight, TextEditCommit } from './PdfTextLayer'
import { OcrTextLayer } from './OcrTextLayer'
import type { OcrPageResult, OcrWord } from '../../types/ocr'
import { t } from '../../i18n'
import type { Annotation, ActiveMode, OmitId } from '../../types/annotation'
import { annotationsForPage } from '../../types/annotation'
import type { AppMode } from '../../types/viewModes'
import { toStoredCoords } from '../../utils/coordinates'
import { PDF_RENDER_SCALE } from '../../utils/constants'
import { sampleBackgroundColor } from '../../utils/sampleBgColor'

// Visual constants for volatile markups
const PEN_COLOR        = '#FFFF00'
const PEN_STROKE_WIDTH = 14   // PDF points → renders ~21px at zoom=1
const PEN_OPACITY      = 0.4
const RECT_COLOR        = '#FF0000'
const RECT_STROKE_WIDTH = 2   // PDF points

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
  // Quantised to 0.25 (not 0.5): the coarser step overshot badly at small
  // zooms — at 41% it asked for 1.5x the pixels the screen would show.
  const desiredRenderScale = Math.ceil(PDF_RENDER_SCALE * zoom * dpr * 4) / 4
  const { pageData, isLoading } = usePdfPage(pdfDoc, pageNumber, desiredRenderScale)

  // ── Drawing state for volatile markups (pen / rectangle) ─────────────────────
  // Stored in PDF points so it scales naturally during in-flight zoom.
  // Hooks must be declared before any early return, so we keep state + the
  // commit fn + the window-level mouseup safety net all here at the top.
  type PenDraw  = { kind: 'pen'; points: number[] }
  type RectDraw = { kind: 'rect'; x: number; y: number; w: number; h: number }
  // Zooming out keeps the higher-resolution canvas (the cache only upgrades), so
  // the compositor still has to shrink it. Canvas defaults to a low-quality
  // filter, which is what mangles small glyphs; ask for the good one. Konva has
  // no config for this, so we reach the underlying 2D context once after mount —
  // read-only access to a field, not a patched library.
  const pageLayerRef = useRef<import('konva/lib/Layer').Layer>(null)
  useEffect(() => {
    const raw = (pageLayerRef.current?.getCanvas()?.getContext() as unknown as
      { _context?: CanvasRenderingContext2D } | undefined)?._context
    if (raw) raw.imageSmoothingQuality = 'high'
  }, [])

  const [draft, setDraft] = useState<PenDraw | RectDraw | null>(null)
  const draftRef = useRef<PenDraw | RectDraw | null>(null)

  // ── Ctrl+drag region → OCR → clipboard (view mode) ───────────────────────────
  // A transient highlighter rectangle: stored in PDF points like the markup draft.
  type Region = { x: number; y: number; w: number; h: number }
  const [region, setRegion] = useState<Region | null>(null)
  const regionRef = useRef<Region | null>(null)
  const [regionBusy, setRegionBusy] = useState(false)

  // Origin point (CSS px, relative to the page box) for the OCR scanning
  // animation when it was kicked off by a double-click. null → the default
  // top→bottom sweep (e.g. when triggered from the toolbar button).
  const [ocrOrigin, setOcrOrigin] = useState<{ x: number; y: number } | null>(null)
  // Drop the origin once recognition ends so the next run starts clean.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when OCR finishes
  useEffect(() => { if (!ocrActive) setOcrOrigin(null) }, [ocrActive])

  // ── HWP native text layer ────────────────────────────────────────────────
  // HWP pages have no pdfjs text layer, but rhwp exposes positioned text runs.
  // Fetch them and render the same selectable overlay OCR uses — so HWP text is
  // selectable / copyable with no OCR pass. PDF and image-only HWP are unaffected.
  const [hwpWords, setHwpWords] = useState<OcrWord[] | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset on dep change
    if (kind !== 'hwp' || !pdfDoc.getPageText) { setHwpWords(null); return }
    let cancelled = false
    pdfDoc.getPageText(pageNumber)
      .then(runs => {
        if (cancelled) return
        setHwpWords(runs.map(r => ({
          text: r.text, score: 1, x: r.x, y: r.y, width: r.width, height: r.height, rotation: 0,
        })))
      })
      .catch(() => { if (!cancelled) setHwpWords([]) })
    return () => { cancelled = true }
  }, [pdfDoc, pageNumber, kind])
  const hasHwpText = !!(hwpWords && hwpWords.length > 0)

  // Whether this page has text a screen reader could actually read. Declared up
  // here with the other hooks: everything below the loading early-return would
  // change hook order between renders.
  const [hasPdfText, setHasPdfText] = useState(false)

  // Ctrl+drag region → OCR the crop → hand the text back (clipboard). useCallback
  // so the Stage's onMouseUp and the window-mouseup net (for drags that end off
  // the Stage, e.g. on the gray margin) share one implementation.
  const finishRegion = useCallback(() => {
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
        const { predict } = await import('../../services/ocrEngine')
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
    window.addEventListener('mouseup', finishRegion)
    return () => window.removeEventListener('mouseup', finishRegion)
  }, [region, finishRegion])

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
        <span className="text-gray-400 text-sm">{t('page.loading', { n: pageNumber })}</span>
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

  // ── Ctrl+drag region → OCR → clipboard ─────────────────────────────────────
  // Active only in view/select mode (not while a markup tool is selected) and
  // only for mouse + Ctrl, so it never interferes with normal clicks or touch.
  const regionTrigger = (e: PointerEvt) =>
    !isDrawing && !!onRegionCopy && (activeMode === null || activeMode === 'select') &&
    e.evt instanceof MouseEvent && e.evt.ctrlKey

  const startRegion = (e: PointerEvt) => {
    const p = getPointerStored(e)
    if (!p) return
    const r: Region = { x: p.x, y: p.y, w: 0, h: 0 }
    regionRef.current = r; setRegion(r)
  }
  const updateRegion = (e: PointerEvt) => {
    const r = regionRef.current
    if (!r) return
    const p = getPointerStored(e)
    if (!p) return
    const next: Region = { x: r.x, y: r.y, w: p.x - r.x, h: p.y - r.y }
    regionRef.current = next; setRegion(next)
  }
  // finishRegion is the useCallback defined in the hooks section above.

  // Combined Stage pointer handlers: markup drawing when a tool is active,
  // otherwise Ctrl+drag region selection.
  const onStageDown = (e: PointerEvt) => { if (isDrawing) handleMouseDown(e); else if (regionTrigger(e)) startRegion(e) }
  const onStageMove = (e: PointerEvt) => { if (draftRef.current) handleMouseMove(e); else if (regionRef.current) updateRegion(e) }
  const onStageUp   = ()             => { if (draftRef.current) commitDraft(); else if (regionRef.current) finishRegion() }

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

  // Click an un-recognized page four times quickly (not while a drawing or
  // placement tool is active) to OCR it, with the scanning animation radiating
  // from the click. `event.detail` is the consecutive-click count, so the 4th
  // rapid click arrives as a click event with detail === 4 — no manual timer.
  //
  // Four rather than three because three is the browser's own select-a-paragraph
  // gesture: on a page that *does* have text, the third click selects a line and
  // starting OCR on top of that is not what the reader asked for.
  const handleQuadClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.detail !== 4) return
    if (!onOcrRequest || ocrResult || ocrActive) return
    if (!(activeMode === null || activeMode === 'select')) return
    const rect = e.currentTarget.getBoundingClientRect()
    setOcrOrigin({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    onOcrRequest(pageNumber)
  }

  const readableText = hasPdfText || hasHwpText || !!(ocrResult && ocrResult.words.length > 0)

  // The outer div holds the layout box (swapped dimensions for 90/270).
  // The inner Stage is rendered at the original orientation and rotated via CSS.
  return (
    <div
      onClick={handleQuadClick}
      style={{ width: stageWidth, height: stageHeight, overflow: 'hidden', position: 'relative' }}
      role="group"
      aria-label={t('page.a11yPage', { n: pageNumber })}
    >
      {/* A page with no text is a picture, and a picture of a document is
          nothing at all to someone using a screen reader — the canvas has no
          text to expose and no name of its own. Saying what it is, and that OCR
          can turn it into words, is the difference between an empty document
          and a document that needs one more step. */}
      {/* A heading per page, so the H key moves page to page — the only
          structure a paginated document has, and the way screen reader users
          skim. Hidden: the page number is already painted in the panel and the
          counter. */}
      <h2 className="sr-only">{t('page.a11yPage', { n: pageNumber })}</h2>
      {!readableText && (
        <p className="sr-only">{t('page.a11yImageOnly', { n: pageNumber })}</p>
      )}
      {/* The canvas is either duplicated by the text layer above it or carries
          nothing readable at all, so it is never worth announcing on its own. */}
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, ...rotationStyle }}>
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
          onTouchStart={isDrawing ? handleMouseDown : undefined}
          onTouchMove={isDrawing ? handleMouseMove : undefined}
          onTouchEnd={isDrawing ? handleMouseUp : undefined}
          style={{ cursor }}
        >
          <Layer ref={pageLayerRef}>
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
          {/* Ctrl+drag region selection (yellow highlighter) */}
          {region && (
            <Layer listening={false}>
              <Rect
                x={(region.w < 0 ? region.x + region.w : region.x) * effectiveZoom}
                y={(region.h < 0 ? region.y + region.h : region.y) * effectiveZoom}
                width={Math.abs(region.w) * effectiveZoom}
                height={Math.abs(region.h) * effectiveZoom}
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
      {regionBusy && (
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
          onTextPresence={setHasPdfText}
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
      {/* Scanning animation while OCR recognizes this page. A double-click
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
