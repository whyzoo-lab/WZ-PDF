import { useState, useCallback } from 'react'
import type { ViewerDoc } from '../types/viewerDoc'
import type { DocKind } from '../types/viewerDoc'
import type { Annotation } from '../types/annotation'
import { t } from '../i18n'
import { pickSaveTarget, saveBlobTo, stripDocExt } from '../utils/download'

interface UseExportersArgs {
  file: File | null
  fileBytes: ArrayBuffer | null
  pdfDoc: ViewerDoc | null
  numPages: number
  annotations: Annotation[]
  kind: DocKind
  /** Password the current document was opened with, if it was encrypted. */
  documentPassword: string | null
  /** Password to put on the next save, or null to save unlocked. Owned by the
   *  toolbar padlock, which sets the intent; saving is what carries it out. */
  savePassword: string | null
  onSuccess: (message: string) => void
  onError: (message: string) => void
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
  documentPassword,
  savePassword,
  onSuccess,
  onError,
}: UseExportersArgs) {
  const [isExporting, setIsExporting] = useState(false)

  const handleExportPdf = useCallback(async () => {
    const password = savePassword ?? undefined
    const baseName = file ? stripDocExt(file.name) : 'document'
    // The name says which of the three things happened, so the file is still
    // recognisable a week later.
    const suffix = password ? '_locked' : documentPassword ? '_unlocked' : '_annotated'
    const downloadName = `${baseName}${suffix}.pdf`
    // Ask where to save BEFORE building anything: the picker needs the click's
    // activation, which a long export would outlive. It also means the success
    // toast can wait until the bytes are really on disk.
    const target = await pickSaveTarget(downloadName, {
      description: 'PDF document', accept: { 'application/pdf': ['.pdf'] },
    })
    if (target.kind === 'canceled') return

    setIsExporting(true)
    try {
      let blob: Blob
      if (kind === 'pdf') {
        if (!fileBytes) return
        const { exportPdf } = await import('../services/pdfExporter')
        blob = await exportPdf(fileBytes, annotations, {
          sourcePassword: documentPassword ?? undefined, password,
        })
      } else {
        // Non-PDF sources have no PDF to patch — build one from the rendered
        // pages (this is also the HWP→PDF converter).
        if (!pdfDoc) return
        const { exportHwpToPdf } = await import('../services/pdfExporter')
        const bytes = await exportHwpToPdf(pdfDoc, annotations, password)
        blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
      }
      if (await saveBlobTo(target, blob, downloadName)) {
        // Saving an encrypted document without a new password takes the
        // password off it. That is the point, but it should be said out loud
        // rather than left for the reader to discover on the next open.
        const message = password
          ? 'export.pdfLockedDone'
          : documentPassword ? 'export.pdfUnlockedDone' : 'export.pdfDone'
        onSuccess(t(message, { name: downloadName }))
      }
    } catch (err) {
      // The reader has already chosen where the file goes; ending in silence
      // here looked like a save that worked. This is also where a wrong or
      // missing password surfaces.
      console.error('PDF export failed:', err)
      onError(t('export.pdfFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setIsExporting(false)
    }
  }, [fileBytes, pdfDoc, annotations, file, kind, documentPassword, savePassword, onSuccess, onError])

  const handleExportHtml = useCallback(async () => {
    const filename = file?.name ?? 'document.pdf'
    const outName = `${stripDocExt(filename)}.html`
    const target = await pickSaveTarget(outName, {
      description: 'HTML viewer', accept: { 'text/html': ['.html'] },
    })
    if (target.kind === 'canceled') return

    setIsExporting(true)
    try {
      let pdfBytes: ArrayBuffer
      if (kind === 'pdf') {
        if (!fileBytes) return
        pdfBytes = fileBytes
      } else {
        // The generated page hands its bytes to the browser's PDF viewer, so
        // they must BE a PDF — passing a .hwp straight through was the bug.
        if (!pdfDoc) return
        const { exportHwpToPdf } = await import('../services/pdfExporter')
        const bytes = await exportHwpToPdf(pdfDoc, annotations)
        pdfBytes = bytes.buffer.slice(
          bytes.byteOffset, bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer
      }
      const { buildHtmlExport } = await import('../services/htmlExporter')
      const out = buildHtmlExport(pdfBytes, filename)
      if (await saveBlobTo(target, out.blob, out.filename)) {
        onSuccess(t('export.htmlDone', { name: out.filename }))
      }
    } catch (err) {
      console.error('HTML export failed:', err)
      alert(t('export.htmlFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setIsExporting(false)
    }
  }, [fileBytes, pdfDoc, annotations, file, kind, onSuccess])

  const handleExportImages = useCallback(async () => {
    if (!pdfDoc) return
    const filename = file?.name ?? 'document.pdf'
    const outName = `${stripDocExt(filename)}_images.zip`
    const target = await pickSaveTarget(outName, {
      description: 'ZIP archive', accept: { 'application/zip': ['.zip'] },
    })
    if (target.kind === 'canceled') return

    setIsExporting(true)
    try {
      const { buildImagesExport } = await import('../services/imageExporter')
      const out = await buildImagesExport(pdfDoc, numPages, filename)
      if (await saveBlobTo(target, out.blob, out.filename)) {
        onSuccess(t('export.imagesDone', { name: out.filename }))
      }
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
