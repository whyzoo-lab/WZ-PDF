import { useState, useCallback } from 'react'
import type { ViewerDoc } from '../types/viewerDoc'
import type { DocKind } from '../types/viewerDoc'
import type { Annotation } from '../types/annotation'
import { doneOcrWords, type OcrPageResult } from '../types/ocr'
import { t } from '../i18n'
import { pickSaveTarget, saveBlobTo, stripDocExt } from '../utils/download'
import { errorMessage } from '../utils/errors'
import { HTML_EXPORT_MAX_BYTES } from '../utils/constants'

interface UseExportersArgs {
  file: { readonly name: string } | null
  fileBytes: ArrayBuffer | null
  /**
   * Why `fileBytes` is null for good rather than still loading — a document
   * too large to hold is paged in for viewing only. Shown instead of saving.
   */
  bytesUnavailable: string | null
  pdfDoc: ViewerDoc | null
  numPages: number
  annotations: Annotation[]
  /** What OCR recognized, by page — kept in the saved PDF as selectable text. */
  ocrResults?: Map<number, OcrPageResult>
  kind: DocKind
  /** Password the current document was opened with, if it was encrypted. */
  documentPassword: string | null
  /** Password to put on the next save, or null to save unlocked. Owned by the
   *  toolbar padlock, which sets the intent; saving is what carries it out. */
  savePassword: string | null
  onSuccess: (message: string) => void
  onError: (message: string) => void
  /** A PDF save completed: what is on screen is now on disk. */
  onPdfSaved?: () => void
}

/**
 * Bundle of export handlers — PDF (with annotations), HTML viewer,
 * images-as-ZIP, and standalone Viewer EXE. Each underlying service is
 * lazy-imported so pdf-lib and jszip stay out of the initial bundle.
 *
 * `isExporting` is shared across all of them: it gates the export menu UI
 * to prevent overlapping operations. Every failure reaches `onError` (the
 * toast) — some used to `alert()`, which blocks the window and, in the
 * embedded web viewer, the page hosting it.
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
  bytesUnavailable,
  pdfDoc,
  numPages,
  annotations,
  ocrResults,
  kind,
  documentPassword,
  savePassword,
  onSuccess,
  onError,
  onPdfSaved,
}: UseExportersArgs) {
  const [isExporting, setIsExporting] = useState(false)

  /**
   * A PDF has bytes to work from; a document too large to hold does not. Said
   * before any save picker opens — choosing where to put a file that cannot be
   * written leaves an empty file behind. True when the export can go ahead.
   */
  const bytesReady = useCallback((): boolean => {
    if (kind !== 'pdf' || fileBytes) return true
    if (bytesUnavailable) onError(bytesUnavailable)
    return false
  }, [kind, fileBytes, bytesUnavailable, onError])

  /**
   * A PDF of a document that is not one (HWP, image), built from its rendered
   * pages — with its own text layer, or what OCR recognized where it has none.
   */
  const renderedPdf = useCallback(async (password?: string): Promise<Uint8Array> => {
    if (!pdfDoc) throw new Error(t('doc.notReady'))
    const { exportHwpToPdf } = await import('../services/pdfExporter')
    return exportHwpToPdf(pdfDoc, annotations, password, doneOcrWords(ocrResults))
  }, [pdfDoc, annotations, ocrResults])

  /** Bytes of a PDF showing the document — the file itself when it is one. */
  const viewerPdfBytes = useCallback(async (): Promise<ArrayBuffer> => {
    if (kind === 'pdf') {
      if (!fileBytes) throw new Error(bytesUnavailable ?? t('doc.notReady'))
      return fileBytes
    }
    const bytes = await renderedPdf()
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }, [kind, fileBytes, bytesUnavailable, renderedPdf])

  /** Save as PDF. Resolves true once the file is written. */
  const handleExportPdf = useCallback(async (): Promise<boolean> => {
    if (!bytesReady()) return false
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
    if (target.kind === 'canceled') return false

    setIsExporting(true)
    try {
      let blob: Blob
      if (kind === 'pdf' && fileBytes) {
        const { exportPdf } = await import('../services/pdfExporter')
        // OCR results live only in memory; written into the file they survive
        // the save, so a scanned document comes back searchable.
        let textLayer
        if (pdfDoc && ocrResults && ocrResults.size > 0) {
          const { placeOcrWords } = await import('../services/ocrTextLayer')
          textLayer = await placeOcrWords(pdfDoc, ocrResults)
        }
        blob = await exportPdf(fileBytes, annotations, {
          sourcePassword: documentPassword ?? undefined, password,
        }, textLayer)
      } else {
        // Non-PDF sources have no PDF to patch — build one from the rendered
        // pages (this is also the HWP→PDF converter).
        const bytes = await renderedPdf(password)
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
        onPdfSaved?.()
        return true
      }
      return false
    } catch (err) {
      // The reader has already chosen where the file goes; ending in silence
      // here looked like a save that worked. This is also where a wrong or
      // missing password surfaces.
      console.error('PDF export failed:', err)
      onError(t('export.pdfFailed', { error: errorMessage(err) }))
      return false
    } finally {
      setIsExporting(false)
    }
  }, [bytesReady, fileBytes, pdfDoc, annotations, ocrResults, file, kind, documentPassword, savePassword, renderedPdf, onSuccess, onError, onPdfSaved])

  const handleExportHtml = useCallback(async () => {
    // The generated page embeds the whole file, so a document too large to hold
    // — or too large for a browser to decode in one piece — cannot become one.
    // Said before the picker, like the others.
    if (!bytesReady()) return
    if (kind === 'pdf' && fileBytes && fileBytes.byteLength > HTML_EXPORT_MAX_BYTES) {
      onError(t('export.htmlTooLarge', { limit: `${HTML_EXPORT_MAX_BYTES / (1024 * 1024)}MB` }))
      return
    }
    const filename = file?.name ?? 'document.pdf'
    const outName = `${stripDocExt(filename)}.html`
    const target = await pickSaveTarget(outName, {
      description: 'HTML viewer', accept: { 'text/html': ['.html'] },
    })
    if (target.kind === 'canceled') return

    setIsExporting(true)
    try {
      // The generated page hands its bytes to the browser's PDF viewer, so
      // they must BE a PDF — passing a .hwp straight through was a bug once.
      const pdfBytes = await viewerPdfBytes()
      const { buildHtmlExport } = await import('../services/htmlExporter')
      const out = buildHtmlExport(pdfBytes, filename)
      if (await saveBlobTo(target, out.blob, out.filename)) {
        onSuccess(t('export.htmlDone', { name: out.filename }))
      }
    } catch (err) {
      console.error('HTML export failed:', err)
      onError(t('export.htmlFailed', { error: errorMessage(err) }))
    } finally {
      setIsExporting(false)
    }
  }, [bytesReady, viewerPdfBytes, kind, fileBytes, file, onSuccess, onError])

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
      onError(t('export.imagesFailed', { error: errorMessage(err) }))
    } finally {
      setIsExporting(false)
    }
  }, [pdfDoc, numPages, file, onSuccess, onError])

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
    if (!bytesReady()) return

    setIsExporting(true)
    try {
      // A PDF, whatever was opened: the main process refuses anything else, so
      // a HWP or an image used to fail here with "Invalid PDF signature".
      const result = await window.electronAPI.exportExe(await viewerPdfBytes())
      if (result.success) {
        onSuccess(t('export.exeDone'))
      } else if (!result.canceled) {
        onError(t('export.exeFailed', { error: result.error ?? t('export.exeUnknownError') }))
      }
    } catch (err) {
      console.error('EXE export error:', err)
      onError(t('export.exeError', { error: errorMessage(err) }))
    } finally {
      setIsExporting(false)
    }
  }, [bytesReady, viewerPdfBytes, onSuccess, onError])

  return {
    isExporting,
    handleExportPdf,
    handleExportHtml,
    handleExportImages,
    handleExportExe,
  }
}
