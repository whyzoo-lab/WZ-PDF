import { useState, useEffect, useRef, useCallback } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPage } from './PdfPage'
import type { Annotation, ActiveMode, OmitId } from '../../types/annotation'
import { PDF_RENDER_SCALE, ZOOM_STEP, MIN_ZOOM, MAX_ZOOM } from '../../utils/constants'

interface FullscreenViewProps {
  pdfDoc: PDFDocumentProxy
  numPages: number
  annotations: Annotation[]
  selectedId: string | null
  /** 'single' shows one page; 'spread' shows two pages side-by-side. */
  layout: 'single' | 'spread'
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
  numPages,
  annotations,
  selectedId,
  layout,
  rotation = 0,
  activeMode = 'select',
  onAnnotationSelect,
  onAnnotationUpdate,
  onAnnotationAdd,
  onExit,
  onCurrentPageChange,
}: FullscreenViewProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const [showOverlay, setShowOverlay] = useState(true)
  const [zoom, setZoom] = useState(1)
  const overlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wheelCooldownRef = useRef(false)
  const deltaXAccRef     = useRef(0)     // 수평 스와이프 누산기

  // ── Single-call guard for onExit ─────────────────────────────────────────
  const exitCalledRef = useRef(false)
  const safeExit = useCallback(() => {
    if (exitCalledRef.current) return
    exitCalledRef.current = true
    onExit()
  }, [onExit])

  // ── Navigation step ───────────────────────────────────────────────────────
  const step = layout === 'spread' ? 2 : 1
  const maxPage = layout === 'spread' && numPages % 2 === 0 ? numPages - 1 : numPages
  const rightPage = layout === 'spread' && currentPage + 1 <= numPages ? currentPage + 1 : null

  // ── Fit zoom calculation ─────────────────────────────────────────────────
  const isRotated90 = rotation === 90 || rotation === 270
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

  // Notify parent when current page changes
  useEffect(() => {
    onCurrentPageChange?.(currentPage)
  }, [currentPage, onCurrentPageChange])

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

  // ── Keyboard handler ───────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (document.fullscreenElement) {
          document.exitFullscreen().then(safeExit).catch(safeExit)
        } else {
          safeExit()
        }
        return
      }

      // ── Next page: Arrow→, Arrow↓, PageDown, Space, Enter
      // Space & Enter cover most USB presentation clickers that don't send
      // PageDown. Backspace covers the 'back' button on clickers.
      if (
        e.key === 'ArrowRight' || e.key === 'ArrowDown' ||
        e.key === 'PageDown' ||
        e.key === ' '         ||  // Space  (most USB clickers)
        e.key === 'Enter'         // Enter
      ) {
        e.preventDefault()
        setCurrentPage(p => Math.min(p + step, maxPage))
        return
      }

      // ── Previous page: Arrow←, Arrow↑, PageUp, Backspace
      if (
        e.key === 'ArrowLeft' || e.key === 'ArrowUp' ||
        e.key === 'PageUp'    ||
        e.key === 'Backspace'     // Back button on USB clickers
      ) {
        e.preventDefault()
        setCurrentPage(p => Math.max(p - step, 1))
        return
      }

      // ── Home → first page, End → last page
      if (e.key === 'Home') {
        e.preventDefault()
        setCurrentPage(1)
        return
      }
      if (e.key === 'End') {
        e.preventDefault()
        setCurrentPage(maxPage)
        return
      }

      // ── Zoom: + / = (in), - (out)
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        setZoom(z => +(Math.min(MAX_ZOOM, z + ZOOM_STEP).toFixed(2)))
      } else if (e.key === '-') {
        e.preventDefault()
        setZoom(z => +(Math.max(MIN_ZOOM, z - ZOOM_STEP).toFixed(2)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, maxPage, safeExit])

  // ── Mouse wheel ───────────────────────────────────────────────────────────
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()

      // Ctrl + wheel → 줌
      if (e.ctrlKey) {
        const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
        setZoom(z => +(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)).toFixed(2)))
        return
      }

      // 수평 스와이프 (터치패드 두 손가락 좌우): |deltaX| > |deltaY| 이면 수평 우선
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        deltaXAccRef.current += e.deltaX
        if (deltaXAccRef.current > 80) {
          deltaXAccRef.current = 0
          setCurrentPage(p => Math.min(p + step, maxPage))
        } else if (deltaXAccRef.current < -80) {
          deltaXAccRef.current = 0
          setCurrentPage(p => Math.max(p - step, 1))
        }
        return
      }

      // 수직 스크롤 시 수평 누산기 리셋 (대각선 스와이프 오작동 방지)
      deltaXAccRef.current = 0

      // 수직 scroll → 페이지 전환 (기존 쿨다운 로직 유지)
      if (wheelCooldownRef.current) return
      if (e.deltaY === 0) return
      wheelCooldownRef.current = true
      setTimeout(() => { wheelCooldownRef.current = false }, 350)
      if (e.deltaY > 0) {
        setCurrentPage(p => Math.min(p + step, maxPage))
      } else {
        setCurrentPage(p => Math.max(p - step, 1))
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [step, maxPage])

  // ── Page overlay ──────────────────────────────────────────────────────────
  const resetOverlay = useCallback(() => {
    setShowOverlay(true)
    if (overlayTimer.current) clearTimeout(overlayTimer.current)
    overlayTimer.current = setTimeout(() => setShowOverlay(false), 2000)
  }, [])

  useEffect(() => {
    resetOverlay()
    return () => { if (overlayTimer.current) clearTimeout(overlayTimer.current) }
  }, [currentPage, resetOverlay])

  const overlayText = rightPage !== null
    ? `Pages ${currentPage}–${rightPage} / ${numPages}`
    : `Page ${currentPage} / ${numPages}`

  const pageProps = {
    pdfDoc,
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
        if (activeMode === 'pen' || activeMode === 'rectangle') return
        // Left-click on the black background (not on the PDF canvas) → next page.
        // This mirrors PowerPoint/Keynote presentation UX.
        // Canvas clicks are excluded so annotation selection still works.
        const target = e.target as HTMLElement
        if (target.tagName !== 'CANVAS') {
          setCurrentPage(p => Math.min(p + step, maxPage))
        }
      }}
    >
      <div className="flex items-center justify-center gap-0">
        <PdfPage {...pageProps} pageNumber={currentPage} />
        {rightPage !== null && (
          <PdfPage {...pageProps} pageNumber={rightPage} />
        )}
      </div>

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
