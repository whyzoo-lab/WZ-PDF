import React, { useState, useCallback, useEffect, useRef } from 'react'
import { ActionBar } from './components/toolbar/ActionBar'
import { Toolbar } from './components/toolbar/Toolbar'
import { PdfViewer } from './components/viewer/PdfViewer'
import { SignaturePad } from './components/modals/SignaturePad'
import { WatermarkConfig } from './components/modals/WatermarkConfig'
import type { WatermarkSettings } from './components/modals/WatermarkConfig'
import { usePdfDocument } from './hooks/usePdfDocument'
import { useAnnotations } from './hooks/useAnnotations'
import { exportPdf } from './services/pdfExporter'
import type { Annotation } from './types/annotation'
import type { AppMode, ViewMode } from './types/viewModes'
import { MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from './utils/constants'

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [fileBytes, setFileBytes] = useState<ArrayBuffer | null>(null)
  const [zoom, setZoom] = useState(1)
  const [showSignaturePad, setShowSignaturePad] = useState(false)
  const [showWatermarkConfig, setShowWatermarkConfig] = useState(false)
  const [pendingStamp, setPendingStamp] = useState<{ src: string; presetId?: string } | null>(null)
  const [pendingSignature, setPendingSignature] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [appMode, setAppMode] = useState<AppMode>('viewer')
  const [viewMode, setViewMode] = useState<ViewMode>('single')
  const [scrollToPage, setScrollToPage] = useState<number | null>(null)

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
  } = useAnnotations()

  // Cache raw bytes for export
  useEffect(() => {
    if (!file) { setFileBytes(null); return }
    let cancelled = false
    file.arrayBuffer().then(buf => { if (!cancelled) setFileBytes(buf) })
    return () => { cancelled = true }
  }, [file])

  // Delete key removes selected annotation (only in editor mode)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && appMode === 'editor') {
        removeAnnotation(selectedId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, removeAnnotation, appMode])

  // Electron: listen for file open events from the main process
  useEffect(() => {
    const cleanup = window.electronAPI?.onOpenFile(async (filePath: string) => {
      try {
        const response = await fetch(`file://${filePath}`)
        const blob = await response.blob()
        const name = filePath.split(/[\\/]/).pop() ?? 'file.pdf'
        const f = new File([blob], name, { type: 'application/pdf' })
        handleUpload(f)
      } catch (err) {
        console.error('Failed to open file from Electron:', err)
      }
    })
    return () => { cleanup?.() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to page after switching from grid → single
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

  const handleUpload = useCallback((f: File) => {
    setFile(f)
    setActiveMode(null)
    setPendingStamp(null)
    setPendingSignature(null)
    setViewMode('single')
  }, [setActiveMode])

  const handleAppModeChange = useCallback((mode: AppMode) => {
    setAppMode(mode)
    // Switching to editor while in fullscreen → exit fullscreen, return to single
    if (mode === 'editor') {
      setViewMode(prev => prev === 'fullscreen' ? 'single' : prev)
    }
  }, [])

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode)
  }, [])

  const handleGridPageClick = useCallback((pageNumber: number) => {
    setScrollToPage(pageNumber)
    setViewMode('single')
  }, [])

  const handleFullscreenExit = useCallback(() => {
    setViewMode('single')
  }, [])

  const handleStampSelect = useCallback((src: string, presetId?: string) => {
    setPendingStamp({ src, presetId })
    setActiveMode('stamp')
  }, [setActiveMode])

  const handleAnnotationAdd = useCallback((annotation: Omit<Annotation, 'id'>) => {
    addAnnotation(annotation)
    setPendingStamp(null)
    setPendingSignature(null)
    setActiveMode('select')
  }, [addAnnotation, setActiveMode])

  const handleWatermarkConfirm = useCallback((settings: WatermarkSettings) => {
    addAnnotation({
      type: 'watermark',
      page: 1,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
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

  const handleExport = useCallback(async () => {
    if (!fileBytes) return
    setIsExporting(true)
    try {
      const blob = await exportPdf(fileBytes, annotations)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const baseName = file ? file.name.replace(/\.pdf$/i, '') : 'document'
      a.download = `${baseName}_annotated.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PDF export failed:', err)
    } finally {
      setIsExporting(false)
    }
  }, [fileBytes, annotations, file])

  const handleZoomIn = useCallback(
    () => setZoom(z => Math.min(+(z + ZOOM_STEP).toFixed(2), MAX_ZOOM)),
    [],
  )
  const handleZoomOut = useCallback(
    () => setZoom(z => Math.max(+(z - ZOOM_STEP).toFixed(2), MIN_ZOOM)),
    [],
  )
  const handleZoomReset = useCallback(() => setZoom(1), [])
  const handleDeleteSelected = useCallback(() => {
    if (selectedId) removeAnnotation(selectedId)
  }, [selectedId, removeAnnotation])
  const handleSignatureClick = useCallback(() => setShowSignaturePad(true), [])
  const handleWatermarkClick = useCallback(() => setShowWatermarkConfig(true), [])

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

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-900">
      <ActionBar
        hasPdf={!!pdfDoc}
        appMode={appMode}
        viewMode={viewMode}
        onUpload={handleUpload}
        onExport={handleExport}
        isExporting={isExporting}
        onAppModeChange={handleAppModeChange}
        onViewModeChange={handleViewModeChange}
      />

      <div className="flex flex-1 overflow-hidden">
        <Toolbar
          activeMode={activeMode}
          selectedId={selectedId}
          zoom={zoom}
          hasPdf={!!pdfDoc}
          appMode={appMode}
          viewMode={viewMode}
          onModeChange={setActiveMode}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          onDeleteSelected={handleDeleteSelected}
          onStampSelect={handleStampSelect}
          onSignatureClick={handleSignatureClick}
          onWatermarkClick={handleWatermarkClick}
        />

        <main className="flex-1 overflow-hidden">
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
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 select-none">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-lg">Drop a PDF here or click Upload PDF</p>
            </div>
          )}
          {pdfDoc && (
            <PdfViewer
              pdfDoc={pdfDoc}
              numPages={numPages}
              zoom={zoom}
              annotations={annotations}
              selectedId={selectedId}
              activeMode={activeMode}
              viewMode={viewMode}
              pendingStamp={pendingStamp}
              pendingSignature={pendingSignature}
              onAnnotationSelect={selectAnnotation}
              onAnnotationUpdate={updateAnnotation}
              onAnnotationAdd={handleAnnotationAdd}
              onGridPageClick={handleGridPageClick}
              onFullscreenExit={handleFullscreenExit}
            />
          )}
        </main>
      </div>

      {showSignaturePad && (
        <SignaturePad
          onConfirm={handleSignatureConfirm}
          onCancel={handleSignatureCancel}
        />
      )}

      {showWatermarkConfig && (
        <WatermarkConfig
          onConfirm={handleWatermarkConfirm}
          onCancel={handleWatermarkCancel}
        />
      )}
    </div>
  )
}
