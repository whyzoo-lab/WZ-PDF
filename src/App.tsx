import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react'
import { ActionBar } from './components/toolbar/ActionBar'
import { PdfViewer } from './components/viewer/PdfViewer'
import type { WatermarkSettings } from './components/modals/WatermarkConfig'
import { usePdfDocument } from './hooks/usePdfDocument'
import { useAnnotations } from './hooks/useAnnotations'
import { useFitZoom } from './hooks/useFitZoom'
import { usePrint } from './hooks/usePrint'
import { useExporters } from './hooks/useExporters'
import { usePageOperations } from './hooks/usePageOperations'
import { useSearch } from './hooks/useSearch'
import { SearchBar } from './components/SearchBar'
import type { Annotation, OmitId } from './types/annotation'
import type { AppMode, ViewMode } from './types/viewModes'
import { MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from './utils/constants'
import { PagePanel } from './components/panel/PagePanel'
import { Toast } from './components/Toast'
import { ErrorBoundary } from './components/ErrorBoundary'
import { t, LANG } from './i18n'

// Modals are loaded on demand to shrink the initial bundle.
// They only render when the user actively summons them, so the round-trip
// to fetch the chunk happens during otherwise-idle interaction time.
const SignaturePad     = lazy(() => import('./components/modals/SignaturePad').then(m => ({ default: m.SignaturePad })))
const WatermarkConfig  = lazy(() => import('./components/modals/WatermarkConfig').then(m => ({ default: m.WatermarkConfig })))
const OpenUrlModal     = lazy(() => import('./components/modals/OpenUrlModal').then(m => ({ default: m.OpenUrlModal })))

export default function App() {
  // ── Document state ────────────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null)
  const [fileBytes, setFileBytes] = useState<ArrayBuffer | null>(null)

  // ── View state ────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)       // 0 | 90 | 180 | 270
  const [appMode, setAppMode] = useState<AppMode>('viewer')
  const [viewMode, setViewMode] = useState<ViewMode>('single')
  const [fullscreenLayout, setFullscreenLayout] = useState<'single' | 'spread'>('single')
  const [scrollToPage, setScrollToPage] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [isPanelOpen, setIsPanelOpen] = useState(false)

  // ── Editing state (pending placement, modals) ─────────────────────────────
  const [pendingStamp, setPendingStamp] = useState<{ src: string; presetId?: string } | null>(null)
  const [pendingSignature, setPendingSignature] = useState<string | null>(null)
  const [showSignaturePad, setShowSignaturePad] = useState(false)
  const [showWatermarkConfig, setShowWatermarkConfig] = useState(false)

  // ── Search state ──────────────────────────────────────────────────────────
  const [showSearch, setShowSearch] = useState(false)

  // ── UI state ──────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const showToast = useCallback((message: string) => {
    setToast({ id: Date.now(), message })
  }, [])

  // Track the view mode before entering fullscreen so we can restore on exit
  const prevViewModeRef = useRef<ViewMode>('single')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { pdfDoc, numPages, isLoading, error } = usePdfDocument(file)
  const {
    annotations,
    selectedId,
    activeMode,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    selectAnnotation,
    setActiveMode,
    remapAnnotations,
    clearMarkups,
  } = useAnnotations()

  // ── Hooks: feature bundles ────────────────────────────────────────────────
  useFitZoom({ pdfDoc, viewMode, rotation, setZoom })
  const search = useSearch(pdfDoc, numPages)
  const { handlePrint, isPrinting, printProgress } = usePrint({ pdfDoc, numPages, annotations })
  const {
    isExporting,
    handleExportPdf,
    handleExportHtml,
    handleExportImages,
    handleExportExe,
  } = useExporters({
    file, fileBytes, pdfDoc, numPages, annotations, onSuccess: showToast,
  })

  // Page CRUD ops: when one succeeds we rewrite `file`, remap annotations,
  // and jump the viewer back to page 1 (the user's edits change the layout
  // so previous scroll position is meaningless).
  const handlePageOpResult = useCallback((newBytes: ArrayBuffer, pageMapping: Map<number, number>) => {
    remapAnnotations(pageMapping)
    const name = file?.name ?? 'document.pdf'
    setFile(new File([newBytes], name, { type: 'application/pdf' }))
    setCurrentPage(1)
    setScrollToPage(1)
  }, [remapAnnotations, file])

  const {
    isPageOperating,
    handleDeletePages,
    handleInsertBlankPage,
    handleInsertFromPdf,
    handleReorderPages,
  } = usePageOperations({ fileBytes, onResult: handlePageOpResult })

  // ── Window title + raw bytes ───────────────────────────────────────────────
  useEffect(() => {
    if (!file) {
      // Resetting derived state when the source `file` prop clears is the
      // intended use of an effect here, not a render-cascade bug.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFileBytes(null)
      document.title = 'WZ PDF'
      return
    }
    document.title = `WZ PDF - ${file.name}`
    let cancelled = false
    file.arrayBuffer().then(buf => { if (!cancelled) setFileBytes(buf) })
    return () => { cancelled = true }
  }, [file])

  // ── Global keyboard shortcuts ─────────────────────────────────────────────
  // Single capture-phase listener covers every shortcut so we don't have to
  // reason about ordering between multiple `window.addEventListener` calls.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null
      const inInput = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)

      // ── App-level shortcuts (work regardless of pdf state) ─────────────────
      if (e.key === 'F1') {
        // Help: open in user's default browser (Electron via IPC + shell;
        // web fallback opens a new tab pointing at the same static asset).
        // Korean locale → help.html, everything else → help.en.html.
        e.preventDefault()
        const helpFile = LANG === 'ko' ? 'help.html' : 'help.en.html'
        if (window.electronAPI?.openHelp) {
          window.electronAPI.openHelp(LANG)
        } else {
          window.open(`./${helpFile}`, '_blank', 'noopener,noreferrer')
        }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('wz-print'))
        return
      }
      // Ctrl/Cmd+F → open the find bar (replaces the browser's native find).
      // Highlighting is single-view only, so switch out of grid/spread.
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && pdfDoc && viewMode !== 'fullscreen') {
        e.preventDefault()
        if (viewMode === 'grid' || viewMode === 'spread') setViewMode('single')
        setShowSearch(true)
        return
      }
      if (e.key === 'F2' && viewMode !== 'fullscreen') {
        e.preventDefault()
        fileInputRef.current?.click()
        return
      }
      if (e.key === 'F5' && pdfDoc && viewMode !== 'fullscreen') {
        // Inline the fullscreen-entry logic (it's also in handleViewModeChange
        // but that's declared further down — avoid the temporal-dead-zone issue).
        e.preventDefault()
        prevViewModeRef.current = viewMode
        setFullscreenLayout(viewMode === 'spread' ? 'spread' : 'single')
        setViewMode('fullscreen')
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && appMode === 'editor') {
        removeAnnotation(selectedId)
        return
      }

      // ── Markup shortcuts — require a PDF and not typing in an input ────────
      if (!pdfDoc || inInput) return

      // ESC two-step priority:
      //   1st press — drawing mode active OR pen/rectangle markups exist:
      //               exit drawing mode + clear all markups (fullscreen stays).
      //   2nd press — nothing to clear, falls through to FullscreenView which
      //               exits fullscreen.
      // Keyboard Lock API (in FullscreenView) keeps the browser from
      // auto-exiting fullscreen on ESC, giving this handler first crack.
      if (e.key === 'Escape') {
        const drawingMode = activeMode === 'pen' || activeMode === 'rectangle'
        const hasMarkups  = annotations.some(a => a.type === 'pen' || a.type === 'rectangle')
        if (drawingMode || hasMarkups) {
          e.preventDefault()
          e.stopImmediatePropagation()
          if (drawingMode) setActiveMode(null)
          if (hasMarkups)  clearMarkups()
          return
        }
      }

      // "1" → highlighter pen, "2" → red rectangle. Toggle off when re-pressed.
      if (e.key === '1') {
        setActiveMode(activeMode === 'pen' ? null : 'pen')
        return
      }
      if (e.key === '2') {
        setActiveMode(activeMode === 'rectangle' ? null : 'rectangle')
        return
      }
    }
    // Capture phase ensures App's handler runs BEFORE FullscreenView's window
    // listener, so stopImmediatePropagation() above actually blocks it.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [selectedId, removeAnnotation, appMode, viewMode, pdfDoc, activeMode, annotations, clearMarkups, setActiveMode])

  // ── Ctrl+scroll → zoom ────────────────────────────────────────────────────
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !pdfDoc || viewMode === 'fullscreen' || viewMode === 'grid') return
      e.preventDefault()
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
      setZoom(z => +(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)).toFixed(2)))
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [pdfDoc, viewMode])

  // ── Scroll-pin guard ──────────────────────────────────────────────────────
  // The app shell (documentElement / body / #root / <main>) must never scroll —
  // only the inner PDF container does. But browser behaviours like
  // scrollIntoView on a focused input, a selected text node, or a clicked
  // annotation can scroll an overflow-hidden ancestor *programmatically*,
  // which pushes the ActionBar off-screen and spawns a phantom window
  // scrollbar. This capture-phase listener resets any such stray scroll to 0
  // the instant it happens, regardless of the trigger.
  useEffect(() => {
    const pin = () => {
      const de = document.documentElement
      if (de.scrollTop) de.scrollTop = 0
      if (de.scrollLeft) de.scrollLeft = 0
      if (document.body.scrollTop) document.body.scrollTop = 0
      if (document.body.scrollLeft) document.body.scrollLeft = 0
      const main = document.querySelector('main')
      if (main) {
        if (main.scrollTop) main.scrollTop = 0
        if (main.scrollLeft) main.scrollLeft = 0
      }
    }
    // Capture phase so we run before the scroll settles visually.
    window.addEventListener('scroll', pin, true)
    return () => window.removeEventListener('scroll', pin, true)
  }, [])

  // ── Scroll to the active search match ─────────────────────────────────────
  // Navigate to the match's page (reusing the single-view scroll mechanism);
  // PdfTextLayer then scrolls the exact match span into view.
  const activeMatchPage = search.active?.page ?? null
  useEffect(() => {
    if (activeMatchPage == null) return
    // Navigating to the active match is an intentional effect-driven action,
    // not a render-cascade smell. Re-runs when the active index changes (even
    // to the same page), so repeated matches on one page still re-scroll.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewMode(v => (v === 'single' ? v : 'single'))
    setScrollToPage(activeMatchPage)
  }, [activeMatchPage, search.activeIndex])

  // ── File loading ──────────────────────────────────────────────────────────

  /** Reset state and load a PDF File object into the viewer. */
  const loadPdfFile = useCallback((f: File) => {
    setFile(f)
    setActiveMode(null)
    setPendingStamp(null)
    setPendingSignature(null)
    setRotation(0)
    setViewMode('single')
    setShowSearch(false)
    search.clear()
  }, [setActiveMode, search])

  /** Main upload handler — accepts PDF files only. */
  const handleUpload = useCallback((f: File) => {
    if (!f.type.includes('pdf') && !f.name.toLowerCase().endsWith('.pdf')) {
      alert(t('error.pdfOnly'))
      return
    }
    loadPdfFile(f)
  }, [loadPdfFile])

  // ── Open from URL ─────────────────────────────────────────────────────────
  const [showUrlModal, setShowUrlModal] = useState(false)
  const [urlLoading, setUrlLoading] = useState(false)

  /** Fetch an online PDF and load it. Electron uses the main process (no CORS);
   *  the web build uses fetch() and surfaces a clear error on CORS failure. */
  const handleOpenUrl = useCallback(async (rawUrl: string) => {
    const url = rawUrl.trim()
    if (!/^https?:\/\//i.test(url)) {
      alert(t('url.invalid'))
      return
    }
    setUrlLoading(true)
    try {
      let bytes: ArrayBuffer
      if (window.electronAPI?.fetchUrl) {
        bytes = await window.electronAPI.fetchUrl(url)
      } else {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        bytes = await res.arrayBuffer()
      }
      const name = (() => {
        try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') } catch { return '' }
      })() || 'document.pdf'
      const filename = name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`
      loadPdfFile(new File([bytes], filename, { type: 'application/pdf' }))
      setShowUrlModal(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // On the web, a thrown TypeError usually means a CORS block.
      const isCors = !window.electronAPI && err instanceof TypeError
      alert(isCors ? t('url.corsBlocked') : t('url.loadFailed', { error: msg }))
    } finally {
      setUrlLoading(false)
    }
  }, [loadPdfFile])

  // ── Electron: open-file (file association / CLI arg) ──────────────────────
  useEffect(() => {
    const cleanup = window.electronAPI?.onOpenFile(async (filePath: string) => {
      try {
        const data = await window.electronAPI!.readFile(filePath)
        const name = filePath.split(/[/\\]/).pop() ?? 'document.pdf'
        const f = new File([data], name, { type: 'application/pdf' })
        loadPdfFile(f)
      } catch (err) {
        console.error('Failed to open file from Electron:', err)
        alert(t('error.openFailed', { error: err instanceof Error ? err.message : String(err) }))
      }
    })
    return () => { cleanup?.() }
  }, [loadPdfFile])

  // ── Electron: open-pdf-bytes (viewer-exe mode — PDF embedded in the exe) ──
  useEffect(() => {
    const cleanup = window.electronAPI?.onOpenPdfBytes((bytes: ArrayBuffer) => {
      const f = new File([bytes], 'document.pdf', { type: 'application/pdf' })
      loadPdfFile(f)
    })
    return () => { cleanup?.() }
  }, [loadPdfFile])

  // ── Scroll to page after grid → single switch ─────────────────────────────
  useEffect(() => {
    if (viewMode === 'single' && scrollToPage !== null) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`pdf-page-${scrollToPage}`)
        const container = document.getElementById('pdf-single-container')
        // Scroll ONLY the dedicated scroll container. el.scrollIntoView()
        // walks up and scrolls every scrollable ancestor — including the
        // overflow-hidden #root/main — which pushes the ActionBar off-screen
        // and leaves a phantom gap + horizontal scrollbar. scrollBy on the
        // container alone keeps the rest of the layout pinned.
        if (el && container) {
          const delta = el.getBoundingClientRect().top - container.getBoundingClientRect().top
          container.scrollBy({ top: delta, behavior: 'smooth' })
        }
        setScrollToPage(null)
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [viewMode, scrollToPage])

  // ── View mode handlers ────────────────────────────────────────────────────
  const handleAppModeChange = useCallback((mode: AppMode) => {
    setAppMode(mode)
    if (mode === 'editor') {
      setViewMode(prev => prev === 'fullscreen' ? 'single' : prev)
    }
  }, [])

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    if (mode === 'fullscreen') {
      prevViewModeRef.current = viewMode
      setFullscreenLayout(viewMode === 'spread' ? 'spread' : 'single')
    }
    setViewMode(mode)
  }, [viewMode])

  const handleGridPageClick = useCallback((pageNumber: number) => {
    setScrollToPage(pageNumber)
    setViewMode('single')
  }, [])

  const handleFullscreenExit = useCallback(() => {
    setViewMode(prevViewModeRef.current)
  }, [])

  const handleRotate = useCallback(() => {
    setRotation(r => (r + 90) % 360)
  }, [])

  // ── Annotation helpers ────────────────────────────────────────────────────
  const handleStampSelect = useCallback((src: string, presetId?: string) => {
    setPendingStamp({ src, presetId })
    setActiveMode('stamp')
  }, [setActiveMode])

  const handleAnnotationAdd = useCallback((annotation: OmitId<Annotation>) => {
    addAnnotation(annotation)
    // Pen / rectangle are volatile — stay in drawing mode for continuous strokes.
    if (annotation.type === 'pen' || annotation.type === 'rectangle') return
    setPendingStamp(null)
    setPendingSignature(null)
    setActiveMode('select')
  }, [addAnnotation, setActiveMode])

  const handleWatermarkConfirm = useCallback((settings: WatermarkSettings) => {
    addAnnotation({
      type: 'watermark',
      page: 1,
      x: 0, y: 0, width: 0, height: 0,
      rotation: settings.rotation,
      text: settings.text,
      opacity: settings.opacity,
      fontSize: settings.fontSize,
      color: settings.color,
      allPages: true,
    })
    setShowWatermarkConfig(false)
    setActiveMode('select')
  }, [addAnnotation, setActiveMode])

  const handleZoomIn    = useCallback(() => setZoom(z => Math.min(+(z + ZOOM_STEP).toFixed(2), MAX_ZOOM)), [])
  const handleZoomOut   = useCallback(() => setZoom(z => Math.max(+(z - ZOOM_STEP).toFixed(2), MIN_ZOOM)), [])
  const handleZoomReset = useCallback(() => setZoom(1), [])

  const handleDeleteSelected = useCallback(() => {
    if (selectedId) removeAnnotation(selectedId)
  }, [selectedId, removeAnnotation])

  const handleResetMarkups = useCallback(() => {
    clearMarkups()
    if (activeMode === 'pen' || activeMode === 'rectangle') setActiveMode(null)
  }, [clearMarkups, activeMode, setActiveMode])

  const handleSignatureClick   = useCallback(() => setShowSignaturePad(true), [])
  const handleWatermarkClick   = useCallback(() => setShowWatermarkConfig(true), [])

  const handleSignatureConfirm = useCallback((dataUrl: string) => {
    setPendingSignature(dataUrl)
    setShowSignaturePad(false)
    setActiveMode('signature')
  }, [setActiveMode])

  const handleSignatureCancel = useCallback(() => {
    setShowSignaturePad(false)
    setActiveMode('select')
  }, [setActiveMode])

  const handleWatermarkCancel = useCallback(() => {
    setShowWatermarkConfig(false)
    setActiveMode('select')
  }, [setActiveMode])

  const handleMainDoubleClick = useCallback(() => {
    if (!pdfDoc) fileInputRef.current?.click()
  }, [pdfDoc])

  const actionBarProps = {
    hasPdf: !!pdfDoc,
    appMode,
    viewMode,
    zoom,
    rotation,
    activeMode,
    selectedId,
    isExporting,
    numPages,
    currentPage,
    isPanelOpen,
    onTogglePanel: () => setIsPanelOpen(v => !v),
    onUpload: handleUpload,
    onOpenUrl: () => setShowUrlModal(true),
    onExportPdf: handleExportPdf,
    onExportHtml: handleExportHtml,
    onExportImages: handleExportImages,
    // EXE Viewer:
    //   - Electron: appends PDF bytes onto the running portable exe.
    //   - Web:      redirects to the installer download (see useExporters).
    onExportExe: handleExportExe,
    onPrint: handlePrint,
    onAppModeChange: handleAppModeChange,
    onViewModeChange: handleViewModeChange,
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onZoomReset: handleZoomReset,
    onRotate: handleRotate,
    onModeChange: setActiveMode,
    onStampSelect: handleStampSelect,
    onSignatureClick: handleSignatureClick,
    onWatermarkClick: handleWatermarkClick,
    onDeleteSelected: handleDeleteSelected,
    onResetMarkups: handleResetMarkups,
    hasMarkups: annotations.some(a => a.type === 'pen' || a.type === 'rectangle'),
  }

  const panelVisible = isPanelOpen && !!pdfDoc && viewMode !== 'fullscreen'

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-gray-900">
      <ActionBar {...actionBarProps} />

      {/* Hidden file input for F2 / double-click to open */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) handleUpload(f)
          e.target.value = ''
        }}
      />

      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile backdrop — taps close the drawer; hidden on md+ where panel is inline. */}
        {panelVisible && (
          <div
            className="md:hidden absolute inset-0 bg-black/50 z-20 no-print"
            onClick={() => setIsPanelOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* PagePanel: inline on md+, slide-over drawer on mobile.
            Hidden during print so only the PDF snapshots are sent to paper. */}
        {panelVisible && (
          <div className="absolute md:static inset-y-0 left-0 z-30 md:z-auto shadow-2xl md:shadow-none no-print">
            <PagePanel
              pdfDoc={pdfDoc}
              numPages={numPages}
              currentPage={currentPage}
              isOperating={isPageOperating}
              readOnly={appMode === 'viewer'}
              onClose={() => setIsPanelOpen(false)}
              onScrollToPage={page => {
                setScrollToPage(page)
                if (viewMode === 'grid') setViewMode('single')
                // On mobile, navigating to a page should close the drawer so
                // the user can see the page they just chose.
                if (window.matchMedia('(max-width: 767px)').matches) {
                  setIsPanelOpen(false)
                }
              }}
              onDeletePages={handleDeletePages}
              onInsertBlankPage={handleInsertBlankPage}
              onInsertFromPdf={handleInsertFromPdf}
              onReorderPages={handleReorderPages}
            />
          </div>
        )}
        <main
          className="flex-1 overflow-hidden"
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) handleUpload(f)
          }}
          onDoubleClick={handleMainDoubleClick}
        >
          {error && (
            <div className="flex items-center justify-center h-full text-red-400 p-4">
              Failed to load PDF: {error}
            </div>
          )}
          {isLoading && (
            <div className="flex items-center justify-center h-full text-gray-400">
              Loading PDF…
            </div>
          )}
          {!pdfDoc && !isLoading && !error && (
            <div
              className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 select-none cursor-pointer px-6 text-center"
              onClick={handleMainDoubleClick}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 sm:w-16 sm:h-16 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm sm:text-lg">
                <span className="hidden sm:inline">{t('empty.desktop')}</span>
                <span className="sm:hidden">{t('empty.mobile')}</span>
              </p>
            </div>
          )}
          {pdfDoc && (
            <ErrorBoundary>
              <PdfViewer
                pdfDoc={pdfDoc}
                numPages={numPages}
                zoom={zoom}
                rotation={rotation}
                appMode={appMode}
                annotations={annotations}
                selectedId={selectedId}
                activeMode={activeMode}
                viewMode={viewMode}
                fullscreenLayout={fullscreenLayout}
                pendingStamp={pendingStamp}
                pendingSignature={pendingSignature}
                onAnnotationSelect={selectAnnotation}
                onAnnotationUpdate={updateAnnotation}
                onAnnotationAdd={handleAnnotationAdd}
                onGridPageClick={handleGridPageClick}
                onFullscreenExit={handleFullscreenExit}
                onCurrentPageChange={setCurrentPage}
                search={showSearch ? { matches: search.matches, activeIndex: search.activeIndex } : undefined}
              />
            </ErrorBoundary>
          )}
        </main>
      </div>

      {/* Find bar (Ctrl+F) */}
      {showSearch && pdfDoc && (
        <SearchBar
          total={search.matches.length}
          activeIndex={search.activeIndex}
          isSearching={search.isSearching}
          onChange={q => search.run(q)}
          onNext={search.next}
          onPrev={search.prev}
          onClose={() => { setShowSearch(false); search.clear() }}
        />
      )}

      {/* Lazy-loaded modals — Suspense fallback is `null` because the user
          clicked a button, so a tiny load delay is acceptable. */}
      <Suspense fallback={null}>
        {showSignaturePad && (
          <SignaturePad onConfirm={handleSignatureConfirm} onCancel={handleSignatureCancel} />
        )}
        {showWatermarkConfig && (
          <WatermarkConfig onConfirm={handleWatermarkConfirm} onCancel={handleWatermarkCancel} />
        )}
        {showUrlModal && (
          <OpenUrlModal
            loading={urlLoading}
            onSubmit={handleOpenUrl}
            onCancel={() => { if (!urlLoading) setShowUrlModal(false) }}
          />
        )}
      </Suspense>
      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          onDismiss={() => setToast(null)}
        />
      )}

      {/* Print preparation overlay. Rendering ~80 pages with annotations
          composited onto canvases can take a few seconds; without this the
          user just sees the UI frozen until the system print dialog appears. */}
      {isPrinting && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center no-print">
          <div className="text-center text-white">
            <div className="animate-spin h-12 w-12 border-4 border-white/80 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-base font-medium">{t('print.preparing')}</p>
            {printProgress.total > 0 && (
              <p className="text-sm text-gray-300 mt-1">
                {t('print.progress', { done: printProgress.done, total: printProgress.total })}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
