import { useState, useCallback } from 'react'
import type { ViewerDoc } from '../types/viewerDoc'
import type { DocKind } from '../types/viewerDoc'
import type { Annotation } from '../types/annotation'
import { t } from '../i18n'
import { downloadBlob, stripDocExt } from '../utils/download'

interface UseExportersArgs {
  file: File | null
  fileBytes: ArrayBuffer | null
  pdfDoc: ViewerDoc | null
  numPages: number
  annotations: Annotation[]
  kind: DocKind
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
 * `handleExportExe` is dual-purpose:
 *   - Electron portable build: appends current PDF bytes onto a copy of the
 *     running exe (the real "EXE Viewer" feature).
 *   - Web build: the feature can't run client-side, so we redirect the user
 *     to download the installer hosted alongside the web app at
 *     `/release/WZ_PDF_Setup_<version>.exe`.
 */
export function useExporters({
  file,
  fileBytes,
  pdfDoc,
  numPages,
  annotations,
  kind,
  onSuccess,
}: UseExportersArgs) {
  const [isExporting, setIsExporting] = useState(false)

  const handleExportPdf = useCallback(async () => {
    setIsExporting(true)
    try {
      const baseName = file ? stripDocExt(file.name) : 'document'
      const downloadName = `${baseName}_annotated.pdf`

      if (kind === 'hwp') {
        // HWP bytes are not a PDF — build a fresh PDF by compositing rendered
        // page canvases with annotations (same technique as the print pipeline).
        if (!pdfDoc) return
        const { exportHwpToPdf } = await import('../services/pdfExporter')
        const pdfBytes = await exportHwpToPdf(pdfDoc, annotations)
        const blob = new Blob([pdfBytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
        downloadBlob(blob, downloadName)
      } else {
        if (!fileBytes) return
        const { exportPdf } = await import('../services/pdfExporter')
        const blob = await exportPdf(fileBytes, annotations)
        downloadBlob(blob, downloadName)
      }

      onSuccess(t('export.pdfDone', { name: downloadName }))
    } catch (err) {
      console.error('PDF export failed:', err)
    } finally {
      setIsExporting(false)
    }
  }, [fileBytes, pdfDoc, annotations, file, kind, onSuccess])

  const handleExportHtml = useCallback(async () => {
    setIsExporting(true)
    try {
      const filename = file?.name ?? 'document.pdf'
      let pdfBytes: ArrayBuffer

      if (kind === 'pdf') {
        if (!fileBytes) return
        pdfBytes = fileBytes
      } else {
        // The exported page hands its bytes to the browser's PDF viewer, so
        // they must BE a PDF. Passing the source bytes straight through was the
        // bug: a .hwp (or an image) was embedded as application/pdf and the
        // generated page could never display it. Convert first — the same
        // canvas-compositing path "Download PDF" uses, so what you see in the
        // exported page matches what you saw in the viewer.
        if (!pdfDoc) return
        const { exportHwpToPdf } = await import('../services/pdfExporter')
        const bytes = await exportHwpToPdf(pdfDoc, annotations)
        pdfBytes = bytes.buffer.slice(
          bytes.byteOffset, bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer
      }

      const { exportAsHtml } = await import('../services/htmlExporter')
      exportAsHtml(pdfBytes, filename)
      onSuccess(t('export.htmlDone', { name: `${stripDocExt(filename)}.html` }))
    } catch (err) {
      console.error('HTML export failed:', err)
      alert(t('export.htmlFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setIsExporting(false)
    }
  }, [fileBytes, pdfDoc, annotations, file, kind, onSuccess])

  const handleExportImages = useCallback(async () => {
    if (!pdfDoc) return
    setIsExporting(true)
    try {
      const { exportAsImages } = await import('../services/imageExporter')
      const filename = file?.name ?? 'document.pdf'
      await exportAsImages(pdfDoc, numPages, filename)
      onSuccess(t('export.imagesDone', { name: `${stripDocExt(filename)}.zip` }))
    } catch (err) {
      console.error('Image export failed:', err)
      alert(t('export.imagesFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setIsExporting(false)
    }
  }, [pdfDoc, numPages, file, onSuccess])

  // EXE Viewer:
  //   - Electron: appends the current PDF bytes onto a copy of the running
  //     portable exe. Main process owns the file dialog + write.
  //   - Web: redirects to the installer download (hosted alongside the web app)
  //     so the user can install the desktop app and use the real feature.
  const handleExportExe = useCallback(async () => {
    // Web fallback: just navigate to the installer download URL.
    if (!window.electronAPI) {
      const installerUrl = `./release/WZ_PDF_Setup_${__APP_VERSION__}.exe`
      const ok = window.confirm(t('export.exeWebPrompt'))
      if (ok) window.location.href = installerUrl
      return
    }

    if (!fileBytes) return
    setIsExporting(true)
    try {
      const result = await window.electronAPI.exportExe(fileBytes)
      if (result.success) {
        onSuccess(t('export.exeDone'))
      } else if (!result.canceled) {
        alert(t('export.exeFailed', { error: result.error ?? t('export.exeUnknownError') }))
      }
    } catch (err) {
      console.error('EXE export error:', err)
      alert(t('export.exeError', { error: err instanceof Error ? err.message : String(err) }))
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
