import { useState, useCallback } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Annotation } from '../types/annotation'

interface UseExportersArgs {
  file: File | null
  fileBytes: ArrayBuffer | null
  pdfDoc: PDFDocumentProxy | null
  numPages: number
  annotations: Annotation[]
  onSuccess: (message: string) => void
}

/**
 * Bundle of export handlers — PDF (with annotations), HTML viewer,
 * images-as-ZIP, and standalone Viewer EXE. Each underlying service is
 * lazy-imported so pdf-lib and jszip stay out of the initial bundle.
 *
 * `isExporting` is shared across all of them: it gates the export menu UI
 * to prevent overlapping operations.
 *
 * `handleExportExe` is only useful when running inside the packaged portable
 * Electron build (it relies on PORTABLE_EXECUTABLE_FILE). Callers should
 * gate it behind `window.electronAPI` and only surface the UI option then.
 */
export function useExporters({
  file,
  fileBytes,
  pdfDoc,
  numPages,
  annotations,
  onSuccess,
}: UseExportersArgs) {
  const [isExporting, setIsExporting] = useState(false)

  const handleExportPdf = useCallback(async () => {
    if (!fileBytes) return
    setIsExporting(true)
    try {
      const { exportPdf } = await import('../services/pdfExporter')
      const blob = await exportPdf(fileBytes, annotations)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const baseName = file ? file.name.replace(/\.pdf$/i, '') : 'document'
      const downloadName = `${baseName}_annotated.pdf`
      a.download = downloadName
      a.click()
      URL.revokeObjectURL(url)
      onSuccess(`PDF 저장 완료 — ${downloadName}`)
    } catch (err) {
      console.error('PDF export failed:', err)
    } finally {
      setIsExporting(false)
    }
  }, [fileBytes, annotations, file, onSuccess])

  const handleExportHtml = useCallback(async () => {
    if (!fileBytes) return
    const { exportAsHtml } = await import('../services/htmlExporter')
    const filename = file?.name ?? 'document.pdf'
    exportAsHtml(fileBytes, filename)
    onSuccess(`HTML Viewer 저장 완료 — ${filename.replace(/\.pdf$/i, '')}.html`)
  }, [fileBytes, file, onSuccess])

  const handleExportImages = useCallback(async () => {
    if (!pdfDoc) return
    setIsExporting(true)
    try {
      const { exportAsImages } = await import('../services/imageExporter')
      const filename = file?.name ?? 'document.pdf'
      await exportAsImages(pdfDoc, numPages, filename)
      onSuccess(`이미지 저장 완료 — ${filename.replace(/\.pdf$/i, '')}.zip`)
    } catch (err) {
      console.error('Image export failed:', err)
      alert(`이미지 내보내기 실패: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsExporting(false)
    }
  }, [pdfDoc, numPages, file, onSuccess])

  // EXE Viewer: appends the current PDF bytes onto a copy of the running
  // portable exe. The main process owns the file dialog + write, so failure
  // modes (no portable env, user-cancel) are surfaced via the return shape.
  const handleExportExe = useCallback(async () => {
    if (!fileBytes) return
    setIsExporting(true)
    try {
      const result = await window.electronAPI!.exportExe(fileBytes)
      if (result.success) {
        onSuccess('EXE Viewer 저장 완료')
      } else if (!result.canceled) {
        alert(`EXE 내보내기 실패\n\n${result.error ?? '알 수 없는 오류'}`)
      }
    } catch (err) {
      console.error('EXE export error:', err)
      alert(`EXE 내보내기 오류: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsExporting(false)
    }
  }, [fileBytes, onSuccess])

  return {
    isExporting,
    handleExportPdf,
    handleExportHtml,
    handleExportImages,
    handleExportExe,
  }
}
