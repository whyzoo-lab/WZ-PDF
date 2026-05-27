import { useState, useCallback, useEffect, useRef } from 'react'
import { ActionBar } from './components/toolbar/ActionBar'
import { PdfViewer } from './components/viewer/PdfViewer'
import { SignaturePad } from './components/modals/SignaturePad'
import { WatermarkConfig } from './components/modals/WatermarkConfig'
import type { WatermarkSettings } from './components/modals/WatermarkConfig'
import { usePdfDocument } from './hooks/usePdfDocument'
import { useAnnotations } from './hooks/useAnnotations'
import { exportPdf } from './services/pdfExporter'
import { exportAsHtml } from './services/htmlExporter'
import { exportAsImages } from './services/imageExporter'
import type { Annotation, OmitId } from './types/annotation'
import type { AppMode, ViewMode } from './types/viewModes'
import { MIN_ZOOM, MAX_ZOOM, ZOOM_STEP, PDF_RENDER_SCALE } from './utils/constants'
import { PagePanel } from './components/panel/PagePanel'
import { Toast } from './components/Toast'
import {
  deletePages,
  insertBlankPage,
  insertPagesFromPdf,
  reorderPages,
} from './services/pdfPageService'

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [fileBytes, setFileBytes] = useState<ArrayBuffer | null>(null)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)       // 0 | 90 | 180 | 270
  const [showSignaturePad, setShowSignaturePad] = useState(false)
  const [showWatermarkConfig, setShowWatermarkConfig] = useState(false)
  const [pendingStamp, setPendingStamp] = useState<{ src: string; presetId?: string } | null>(null)
  const [pendingSignature, setPendingSignature] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isPanelOpen,     setIsPanelOpen]     = useState(false)
  const [isPageOperating, setIsPageOperating] = useState(false)
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)

  const showToast = useCallback((message: string) => {
    setToast({ id: Date.now(), message })
  }, [])
  const [appMode, setAppMode] = useState<AppMode>('viewer')
  const [viewMode, setViewMode] = useState<ViewMode>('single')
  const [scrollToPage, setScrollToPage] = useState<number | null>(null)
  const [fullscreenLayout, setFullscreenLayout] = useState<'single' | 'spread'>('single')
  const [currentPage, setCurrentPage] = useState(1)

  // Track the view mode before entering fullscreen so we can restore it on exit
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
  } = useAnnotations()

  // ── Auto-fit zoom ──────────────────────────────────────────────────────────
  const calcFitZoom = useCallback(async (
    doc: typeof pdfDoc,
    mode: ViewMode,
    rot: number,
  ) => {
    if (!doc || mode === 'fullscreen' || mode === 'grid') return
    try {
      const page = await doc.getPage(1)
      const vp = page.getViewport({ scale: PDF_RENDER_SCALE })
      const isRotated90 = rot === 90 || rot === 270
      const pageW = isRotated90 ? vp.height : vp.width
      const pageH = isRotated90 ? vp.width  : vp.height

      const ACTION_BAR_H = 44
      const SCROLLBAR   = 18
      const isSpread = mode === 'spread'
      const V_PAD = isSpread ? 32 : 48
      const H_PAD = isSpread ? 16 : 32
      const availW = window.innerWidth  - H_PAD - SCROLLBAR
      const availH = window.innerHeight - ACTION_BAR_H - V_PAD

      let fitZoom: number
      if (isSpread) {
        fitZoom = Math.min(availW / (pageW * 2), availH / pageH)
      } else {
        fitZoom = Math.min(availW / pageW, availH / pageH)
      }
      fitZoom = Math.floor(fitZoom * 100) / 100
      fitZoom = Math.max(0.1, Math.min(MAX_ZOOM, fitZoom))
      setZoom(fitZoom)
    } catch (err) {
      console.error('Auto-fit zoom failed:', err)
    }
  }, [])

  useEffect(() => {
    if (!pdfDoc) return
    const t = setTimeout(() => calcFitZoom(pdfDoc, viewMode, rotation), 80)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc])

  useEffect(() => {
    if ((viewMode === 'single' || viewMode === 'spread') && pdfDoc) {
      calcFitZoom(pdfDoc, viewMode, rotation)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode])

  useEffect(() => {
    if ((viewMode === 'single' || viewMode === 'spread') && pdfDoc) {
      calcFitZoom(pdfDoc, viewMode, rotation)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotation])

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
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && appMode === 'editor') {
        removeAnnotation(selectedId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, removeAnnotation, appMode, viewMode])

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

  // ── Handlers ───────────────────────────────────────────────────────────────

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

  // F5 → enter fullscreen
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F5' && pdfDoc && viewMode !== 'fullscreen') {
        e.preventDefault()
        handleViewModeChange('fullscreen')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pdfDoc, viewMode, handleViewModeChange])

  const handleFullscreenExit = useCallback(() => {
    setViewMode(prevViewModeRef.current)
  }, [])

  const handleRotate = useCallback(() => {
    setRotation(r => (r + 90) % 360)
  }, [])

  // ── Print ─────────────────────────────────────────────────────────────────
  const handlePrint = useCallback(async () => {
    const list: Array<{ container: HTMLDivElement; img: HTMLImageElement }> = []
    document.querySelectorAll<HTMLDivElement>('.konvajs-content').forEach(container => {
      const canvases = Array.from(container.querySelectorAll<HTMLCanvasElement>('canvas'))
      if (!canvases.length) return
      const [first] = canvases
      const comp = document.createElement('canvas')
      comp.width  = first.width
      comp.height = first.height
      const ctx = comp.getContext('2d')
      if (ctx) canvases.forEach(c => ctx.drawImage(c, 0, 0))
      const img = document.createElement('img')
      img.src = comp.toDataURL('image/jpeg', 0.95)
      img.setAttribute('data-wz-print', '')
      img.style.cssText = [
        `width:${container.offsetWidth}px`,
        `height:${container.offsetHeight}px`,
        'display:block',
        'max-width:100%',
      ].join(';')
      container.before(img)
      container.setAttribute('data-wz-hide', '')
      container.style.display = 'none'
      list.push({ container, img })
    })
    if (window.electronAPI?.printWindow) {
      await window.electronAPI.printWindow()
    } else {
      window.print()
    }
    list.forEach(({ container, img }) => {
      img.remove()
      container.style.display = ''
      container.removeAttribute('data-wz-hide')
    })
  }, [])

  useEffect(() => {
    const onPrint = () => { handlePrint() }
    document.addEventListener('wz-print', onPrint)
    return () => document.removeEventListener('wz-print', onPrint)
  }, [handlePrint])

  // ── Export: PDF ───────────────────────────────────────────────────────────
  const handleExportPdf = useCallback(async () => {
    if (!fileBytes) return
    setIsExporting(true)
    try {
      const blob = await exportPdf(fileBytes, annotations)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const baseName = file ? file.name.replace(/\.pdf$/i, '') : 'document'
      const downloadName = `${baseName}_annotated.pdf`
      a.download = downloadName
      a.click()
      URL.revokeObjectURL(url)
      showToast(`PDF 저장 완료 — ${downloadName}`)
    } catch (err) {
      console.error('PDF export failed:', err)
    } finally {
      setIsExporting(false)
    }
  }, [fileBytes, annotations, file, showToast])

  // ── Export: HTML Viewer ───────────────────────────────────────────────────
  const handleExportHtml = useCallback(() => {
    if (!fileBytes) return
    const filename = file?.name ?? 'document.pdf'
    exportAsHtml(fileBytes, filename)
    showToast(`HTML Viewer 저장 완료 — ${filename.replace(/\.pdf$/i, '')}.html`)
  }, [fileBytes, file, showToast])

  // ── Export: Images ZIP ────────────────────────────────────────────────────
  const handleExportImages = useCallback(async () => {
    if (!pdfDoc) return
    setIsExporting(true)
    try {
      const filename = file?.name ?? 'document.pdf'
      await exportAsImages(pdfDoc, numPages, filename)
      showToast(`이미지 저장 완료 — ${filename.replace(/\.pdf$/i, '')}.zip`)
    } catch (err) {
      console.error('Image export failed:', err)
      alert(`이미지 내보내기 실패: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsExporting(false)
    }
  }, [pdfDoc, numPages, file, showToast])

  // ── Export: EXE Viewer (Electron portable only) ───────────────────────────
  const handleExportExe = useCallback(async () => {
    if (!fileBytes) return
    setIsExporting(true)
    try {
      const result = await window.electronAPI!.exportExe(fileBytes)
      if (result.success) {
        showToast('EXE Viewer 저장 완료')
      } else if (!result.canceled) {
        alert(`EXE 내보내기 실패\n\n${result.error ?? '알 수 없는 오류'}`)
      }
    } catch (err) {
      console.error('EXE export error:', err)
      alert(`EXE 내보내기 오류: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsExporting(false)
    }
  }, [fileBytes, showToast])

  // ── Annotation helpers ────────────────────────────────────────────────────
  const handleStampSelect = useCallback((src: string, presetId?: string) => {
    setPendingStamp({ src, presetId })
    setActiveMode('stamp')
  }, [setActiveMode])

  const handleAnnotationAdd = useCallback((annotation: OmitId<Annotation>) => {
    addAnnotation(annotation)
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

  // ── 페이지 조작 ───────────────────────────────────────────────────────────────
  const handlePageOperation = useCallback((
    newBytes: ArrayBuffer,
    pageMapping: Map<number, number>,
  ) => {
    remapAnnotations(pageMapping)
    const name = file?.name ?? 'document.pdf'
    setFile(new File([newBytes], name, { type: 'application/pdf' }))
    setCurrentPage(1)
    setScrollToPage(1)
    setIsPageOperating(false)
  }, [remapAnnotations, file])

  const handleDeletePages = useCallback(async (pageNums: number[]) => {
    if (!fileBytes) return
    setIsPageOperating(true)
    try {
      const { newBytes, pageMapping } = await deletePages(fileBytes, pageNums)
      handlePageOperation(newBytes, pageMapping)
    } catch (err) {
      console.error('페이지 삭제 실패:', err)
      setIsPageOperating(false)
    }
  }, [fileBytes, handlePageOperation])

  const handleInsertBlankPage = useCallback(async (afterPage: number) => {
    if (!fileBytes) return
    setIsPageOperating(true)
    try {
      const { newBytes, pageMapping } = await insertBlankPage(fileBytes, afterPage)
      handlePageOperation(newBytes, pageMapping)
    } catch (err) {
      console.error('빈 페이지 삽입 실패:', err)
      setIsPageOperating(false)
    }
  }, [fileBytes, handlePageOperation])

  const handleInsertFromPdf = useCallback(async (afterPage: number, srcBytes: ArrayBuffer) => {
    if (!fileBytes) return
    setIsPageOperating(true)
    try {
      const { newBytes, pageMapping } = await insertPagesFromPdf(fileBytes, srcBytes, afterPage)
      handlePageOperation(newBytes, pageMapping)
    } catch (err) {
      console.error('PDF 병합 실패:', err)
      alert(`PDF를 삽입할 수 없습니다: ${err instanceof Error ? err.message : String(err)}`)
      setIsPageOperating(false)
    }
  }, [fileBytes, handlePageOperation])

  const handleReorderPages = useCallback(async (newOrder: number[]) => {
    if (!fileBytes) return
    setIsPageOperating(true)
    try {
      const { newBytes, pageMapping } = await reorderPages(fileBytes, newOrder)
      handlePageOperation(newBytes, pageMapping)
    } catch (err) {
      console.error('페이지 순서 변경 실패:', err)
      setIsPageOperating(false)
    }
  }, [fileBytes, handlePageOperation])

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
    // EXE export only available in Electron context
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

      {showSignaturePad && (
        <SignaturePad onConfirm={handleSignatureConfirm} onCancel={handleSignatureCancel} />
      )}
      {showWatermarkConfig && (
        <WatermarkConfig onConfirm={handleWatermarkConfirm} onCancel={handleWatermarkCancel} />
      )}
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
