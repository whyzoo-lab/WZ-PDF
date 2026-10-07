import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { buildSpreads, spreadIndexOf } from '../../utils/spreadLayout'
import type { ViewerDoc, DocKind } from '../../types/viewerDoc'
import { PdfPage } from './PdfPage'
import { t } from '../../i18n'
import type { Annotation, ActiveMode, OmitId } from '../../types/annotation'
import { PresentationOverlay } from './PresentationOverlay'
import { PresentationHud } from './PresentationHud'
import { spotZoomStyle, isDrawingTool, DEFAULT_TOOL_STATE } from '../../utils/presentTools'
import type { PresentStroke, PresentToolState } from '../../types/present'
import { useFullscreenFitZoom } from '../../hooks/useFullscreenFitZoom'
import { usePresenterKeys } from '../../hooks/usePresenterKeys'
import { usePresenterWheel } from '../../hooks/usePresenterWheel'

interface FullscreenViewProps {
  pdfDoc: ViewerDoc
  kind: DocKind
  numPages: number
  annotations: Annotation[]
  selectedId: string | null
  /** 'single' shows one page; 'spread' shows two pages side-by-side. */
  layout: 'single' | 'spread'
  /** Two-page rows for the spread layout (`buildSpreads`). Plain pairs when absent. */
  spreads?: number[][]
  /** Page to open on. Defaults to the first. */
  startPage?: number
  /**
   * The page being read aloud, or null. Each time it changes the presentation
   * turns to it — so reading aloud moves through the pages, while the presenter
   * can still page freely between sentences.
   */
  followPage?: number | null
  rotation?: number
  /** Active editing/drawing mode (e.g. 'pen', 'rectangle'). Defaults to 'select'. */
  activeMode?: ActiveMode
  onAnnotationSelect: (id: string | null) => void
  onAnnotationUpdate: (id: string, updates: Partial<Annotation>) => void
  /** Called when a new pen/rectangle stroke is committed. */
  onAnnotationAdd?: (annotation: OmitId<Annotation>) => void
  onExit: () => void
  /** Called whenever the displayed page changes, so parent can update its page indicator. */
  onCurrentPageChange?: (page: number) => void
}

export function FullscreenView({
  pdfDoc,
  kind,
  numPages,
  annotations,
  selectedId,
  layout,
  spreads,
  startPage = 1,
  followPage = null,
  rotation = 0,
  activeMode = 'select',
  onAnnotationSelect,
  onAnnotationUpdate,
  onAnnotationAdd,
  onExit,
  onCurrentPageChange,
}: FullscreenViewProps) {
  // `currentPage` may be any page; what is shown is the row that contains it.
  // So a start on the right-hand page of a pair opens that pair, and rows that
  // are re-cut once page sizes arrive never leave the view between two rows.
  const [currentPage, setCurrentPage] = useState(() => Math.min(Math.max(1, Math.floor(startPage)), numPages || 1))
  // Turn to the page being read when it changes — adjusted during render, as
  // React advises for state derived from a changing prop, rather than in an
  // effect that would paint the old page first. Starts unset, so a show opened
  // while reading opens on the page being read.
  const [followed, setFollowed] = useState<number | null>(null)
  if (followPage !== followed) {
    setFollowed(followPage)
    if (followPage !== null) setCurrentPage(Math.min(Math.max(1, followPage), numPages || 1))
  }
  const [showOverlay, setShowOverlay] = useState(true)
  const [tool, setTool] = useState<PresentToolState>(DEFAULT_TOOL_STATE)
  const [strokes, setStrokes] = useState<PresentStroke[]>([])
  const [spot, setSpot] = useState<{ scale: number; x: number; y: number } | null>(null)
  const overlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Single-call guard for onExit ─────────────────────────────────────────
  const exitCalledRef = useRef(false)
  const safeExit = useCallback(() => {
    if (exitCalledRef.current) return
    exitCalledRef.current = true
    onExit()
  }, [onExit])

  // ── Navigation: by page, or by two-page row (a wide page is a row alone) ──
  const rows = useMemo(
    () => (layout === 'spread' ? spreads ?? buildSpreads(numPages, null) : null),
    [layout, spreads, numPages],
  )
  const row = rows ? rows[spreadIndexOf(rows, currentPage)] ?? [currentPage] : [currentPage]
  const leftPage = row[0]
  const rightPage = row[1] ?? null
  const nextPage = useCallback((p: number) => {
    if (!rows) return Math.min(p + 1, numPages)
    return rows[Math.min(spreadIndexOf(rows, p) + 1, rows.length - 1)][0]
  }, [rows, numPages])
  const prevPage = useCallback((p: number) => {
    if (!rows) return Math.max(p - 1, 1)
    return rows[Math.max(spreadIndexOf(rows, p) - 1, 0)][0]
  }, [rows])

  // ── Fit zoom (auto-fit page to window + presenter zoom nudges) ────────────
  const isRotated90 = rotation === 90 || rotation === 270
  const { zoom, setZoom } = useFullscreenFitZoom({ pdfDoc, currentPage: leftPage, rightPage, isRotated90 })

  // Notify parent when the page shown changes
  useEffect(() => {
    onCurrentPageChange?.(leftPage)
  }, [leftPage, onCurrentPageChange])

  // Presenter strokes are per-slide and transient.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional per-slide reset on page change
  useEffect(() => { setStrokes([]); setSpot(null) }, [leftPage])

  // ── OS fullscreen lifecycle ───────────────────────────────────────────────
  // We use the Keyboard Lock API (Chrome / Electron) to capture the ESC key
  // ourselves. Without this, the browser/OS auto-exits fullscreen on ESC
  // *before* any JS keydown handler fires — which breaks the "ESC clears
  // drawings first, then ESC again exits fullscreen" two-step behavior.
  useEffect(() => {
    document.documentElement.requestFullscreen().catch(console.error)
    type KbLockNav = Navigator & { keyboard?: { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void } }
    const kb = (navigator as KbLockNav).keyboard
    kb?.lock?.(['Escape']).catch(() => { /* ignore — fall back to default browser behavior */ })
    return () => {
      kb?.unlock?.()
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(console.error)
      }
    }
  }, [])

  // ── fullscreenchange: reliable exit trigger ───────────────────────────────
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        safeExit()
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [safeExit])

  // ── Presenter keymap (page nav, tools, ESC two-step, +/- zoom) ────────────
  usePresenterKeys({ nextPage, prevPage, lastPage: numPages, safeExit, tool, strokes, spot, setStrokes, setTool, setSpot, setCurrentPage, setZoom })

  // ── Spotlight follows cursor ──────────────────────────────────────────────
  useEffect(() => {
    if (!spot) return
    const onMove = (e: MouseEvent) => setSpot(s => (s ? { ...s, x: e.clientX, y: e.clientY } : s))
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [spot])

  // ── Mouse wheel (spot scale, Ctrl+zoom, swipe / scroll page nav) ──────────
  usePresenterWheel({ nextPage, prevPage, spot, setSpot, setZoom, setCurrentPage })

  // ── Page overlay ──────────────────────────────────────────────────────────
  const resetOverlay = useCallback(() => {
    setShowOverlay(true)
    if (overlayTimer.current) clearTimeout(overlayTimer.current)
    overlayTimer.current = setTimeout(() => setShowOverlay(false), 2000)
  }, [])

  useEffect(() => {
    // Show the page-number overlay briefly whenever the page changes —
    // intentional effect-driven UI feedback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resetOverlay()
    return () => { if (overlayTimer.current) clearTimeout(overlayTimer.current) }
  }, [leftPage, resetOverlay])

  const overlayText = rightPage !== null
    ? t('present.pages', { a: leftPage, b: rightPage, total: numPages })
    : t('present.page', { n: leftPage, total: numPages })

  const pageProps = {
    pdfDoc,
    kind,
    zoom,
    rotation,
    annotations,
    selectedId,
    activeMode,
    pendingStamp: null,
    pendingSignature: null,
    onAnnotationSelect,
    onAnnotationUpdate,
    onAnnotationAdd: onAnnotationAdd ?? (() => {}),
  }

  return (
    <div
      className="fixed inset-0 bg-black flex items-center justify-center z-50"
      onClick={(e) => {
        resetOverlay()
        // While drawing (pen / rectangle) suppress auto-advance so margin
        // clicks don't accidentally skip pages mid-stroke.
        if (activeMode === 'pen' || activeMode === 'rectangle' || isDrawingTool(tool.kind) || spot) return
        // Left-click on the black background (not on the PDF canvas) → next page.
        // This mirrors PowerPoint/Keynote presentation UX.
        // Canvas clicks are excluded so annotation selection still works.
        const target = e.target as HTMLElement
        if (target.tagName !== 'CANVAS') {
          setCurrentPage(nextPage)
        }
      }}
    >
      <div
        className="flex items-center justify-center gap-0"
        style={spot ? spotZoomStyle(spot.scale, spot.x, spot.y) : undefined}
      >
        <PdfPage {...pageProps} pageNumber={leftPage} />
        {rightPage !== null && (
          <PdfPage {...pageProps} pageNumber={rightPage} />
        )}
      </div>

      <PresentationOverlay
        strokes={strokes}
        tool={tool}
        onAddStroke={(s) => setStrokes(prev => [...prev, s])}
      />
      <PresentationHud tool={tool} />

      {/* Page N / M overlay */}
      <div
        className={`fixed bottom-8 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded text-sm pointer-events-none transition-opacity duration-500 ${
          showOverlay ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {overlayText}
      </div>
    </div>
  )
}
