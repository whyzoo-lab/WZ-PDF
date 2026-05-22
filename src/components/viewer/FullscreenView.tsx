import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPage } from './PdfPage'
import type { Annotation } from '../../types/annotation'
import { PDF_RENDER_SCALE } from '../../utils/constants'

interface FullscreenViewProps {
  pdfDoc: PDFDocumentProxy
  numPages: number
  annotations: Annotation[]
  selectedId: string | null
  onAnnotationSelect: (id: string | null) => void
  onAnnotationUpdate: (id: string, updates: Partial<Annotation>) => void
  onExit: () => void
}

export function FullscreenView({
  pdfDoc,
  numPages,
  annotations,
  selectedId,
  onAnnotationSelect,
  onAnnotationUpdate,
  onExit,
}: FullscreenViewProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const [showOverlay, setShowOverlay] = useState(true)
  const [zoom, setZoom] = useState(1)
  const overlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exitingRef = useRef(false)

  // Shared zoom calculation
  const calcZoom = useCallback(() => {
    pdfDoc.getPage(currentPage).then(page => {
      const vp = page.getViewport({ scale: PDF_RENDER_SCALE })
      setZoom(Math.min(
        window.innerHeight / vp.height,
        window.innerWidth / vp.width,
      ))
    }).catch(console.error)
  }, [pdfDoc, currentPage])

  // Calculate zoom from page dimensions to fill screen height
  useEffect(() => {
    calcZoom()
  }, [calcZoom])

  // Recalculate zoom on resize
  useEffect(() => {
    window.addEventListener('resize', calcZoom)
    return () => window.removeEventListener('resize', calcZoom)
  }, [calcZoom])

  // Request OS fullscreen on mount; exit on unmount
  useEffect(() => {
    document.documentElement.requestFullscreen().catch(console.error)
    return () => {
      exitingRef.current = true
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(console.error)
      }
    }
  }, [])

  // Detect user-initiated fullscreen exit (Escape key triggers this via browser)
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && !exitingRef.current) {
        onExit()
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [onExit])

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        setCurrentPage(p => Math.min(p + 1, numPages))
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        setCurrentPage(p => Math.max(p - 1, 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [numPages])

  // Page overlay: show briefly on page change, fade after 2s
  const resetOverlay = useCallback(() => {
    setShowOverlay(true)
    if (overlayTimer.current) clearTimeout(overlayTimer.current)
    overlayTimer.current = setTimeout(() => setShowOverlay(false), 2000)
  }, [])

  useEffect(() => {
    setShowOverlay(true)
    if (overlayTimer.current) clearTimeout(overlayTimer.current)
    overlayTimer.current = setTimeout(() => setShowOverlay(false), 2000)
    return () => { if (overlayTimer.current) clearTimeout(overlayTimer.current) }
  }, [currentPage])

  return (
    <div
      className="fixed inset-0 bg-black flex items-center justify-center z-50"
      onClick={resetOverlay}
    >
      <PdfPage
        pdfDoc={pdfDoc}
        pageNumber={currentPage}
        zoom={zoom}
        annotations={annotations}
        selectedId={selectedId}
        activeMode="select"
        pendingStamp={null}
        pendingSignature={null}
        onAnnotationSelect={onAnnotationSelect}
        onAnnotationUpdate={onAnnotationUpdate}
        onAnnotationAdd={() => {}}
      />

      {/* Page N / M overlay */}
      <div
        className={`fixed bottom-8 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded text-sm pointer-events-none transition-opacity duration-500 ${
          showOverlay ? 'opacity-100' : 'opacity-0'
        }`}
      >
        Page {currentPage} / {numPages}
      </div>
    </div>
  )
}
