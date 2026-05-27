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
import type { Annotation, OmitId } from './types/annotation'
import type { AppMode, ViewMode } from './types/viewModes'
import { MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from './utils/constants'
import { PagePanel } from './components/panel/PagePanel'
import { Toast } from './components/Toast'

// Modals are loaded on demand to shrink the initial bundle.
// They only render when the user actively summons them, so the round-trip
// to fetch the chunk happens during otherwise-idle interaction time.
const SignaturePad     = lazy(() => import('./components/modals/SignaturePad').then(m => ({ default: m.SignaturePad })))
const WatermarkConfig  = lazy(() => import('./components/modals/WatermarkConfig').then(m => ({ default: m.WatermarkConfig })))

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
  const { handlePrint } = usePrint()
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
        e.preventDefault()
        if (window.electronAPI?.openHelp) {
          window.electronAPI.openHelp()
        } else {
          window.open('./help.html', '_blank', 'noopener,noreferrer')
        }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('wz-print'))
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

  // ── File loading ──────────────────────────────────────────────────────────

  /** Reset state and load a PDF File object into the viewer. */
  const loadPdfFile = useCallback((f: File) => {
    setFile(f)
    setActiveMode(null)
    setPendingStamp(null)
    setPendingSignature(null)
    setRotation(0)
    setViewMode('single')
  }, [setActiveMode])

  /** Main upload handler — accepts PDF files only. */
  const handleUpload = useCallback((f: File) => {
    if (!f.type.includes('pdf') && !f.name.toLowerCase().endsWith('.pdf')) {
      alert('PDF 파일만 열 수 있습니다.')
      return
    }
    loadPdfFile(f)
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
        alert(`파일을 열 수 없습니다: ${err instanceof Error ? err.message : String(err)}`)
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
        el?.scrollIntoView({ behavior: 'smooth' })
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
    onExportPdf: handleExportPdf,
    onExportHtml: handleExportHtml,
    onExportImages: handleExportImages,
    // EXE export only available in Electron context (portable build)
    onExportExe: window.electronAPI ? handleExportExe : undefined,
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
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-900">
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

      <div className="flex flex-1 overflow-hidden">
        {isPanelOpen && pdfDoc && viewMode !== 'fullscreen' && (
          <PagePanel
            pdfDoc={pdfDoc}
            numPages={numPages}
            currentPage={currentPage}
            isOperating={isPageOperating}
            readOnly={appMode === 'viewer'}
            onScrollToPage={page => {
              setScrollToPage(page)
              if (viewMode === 'grid') setViewMode('single')
            }}
            onDeletePages={handleDeletePages}
            onInsertBlankPage={handleInsertBlankPage}
            onInsertFromPdf={handleInsertFromPdf}
            onReorderPages={handleReorderPages}
          />
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
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 select-none cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-lg">PDF를 여기에 드래그하거나 Open 버튼 또는 F2를 누르세요</p>
            </div>
          )}
          {pdfDoc && (
            <PdfViewer
              pdfDoc={pdfDoc}
              numPages={numPages}
              zoom={zoom}
              rotation={rotation}
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
            />
          )}
        </main>
      </div>

      {/* Lazy-loaded modals — Suspense fallback is `null` because the user
          clicked a button, so a tiny load delay is acceptable. */}
      <Suspense fallback={null}>
        {showSignaturePad && (
          <SignaturePad onConfirm={handleSignatureConfirm} onCancel={handleSignatureCancel} />
        )}
        {showWatermarkConfig && (
          <WatermarkConfig onConfirm={handleWatermarkConfirm} onCancel={handleWatermarkCancel} />
        )}
      </Suspense>
      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  )
}
