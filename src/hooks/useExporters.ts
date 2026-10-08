import { useState, useCallback } from 'react'
import type { ViewerDoc } from '../types/viewerDoc'
import type { DocKind } from '../types/viewerDoc'
import { isVolatile, type Annotation } from '../types/annotation'
import { doneOcrWords, type OcrPageResult } from '../types/ocr'
import { t } from '../i18n'
import { pickSaveTarget, saveBlobTo, stripDocExt } from '../utils/download'
import { errorMessage } from '../utils/errors'
import { HTML_EXPORT_MAX_BYTES } from '../utils/constants'
import { documentFileName, openableExt } from '../utils/docFileName'

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
  /** Markdown as it stands in the editor, which may differ from the file. */
  getMarkdownText?: () => string | null
  /** The page in view — for an image collection, whose picture "save original" saves. */
  currentPage?: number
}

/**
 * Bundle of export handlers. Three apply to every format — the file itself
 * (`handleSaveOriginal`), a PDF of it (`handleExportPdf`; Word, PowerPoint and
 * sheets have their own in App, which needs the view), and a viewer exe
 * carrying it (`handleExportExe`) — and the rest to page documents: booklet,
 * HTML viewer, images-as-ZIP. Each underlying service is lazy-imported so
 * pdf-lib and jszip stay out of the initial bundle.
 *
 * `isExporting` is shared across all of them: it gates the export menu UI
 * to prevent overlapping operations. Every failure reaches `onError` (the
 * toast) — some used to `alert()`, which blocks the window and, in the
 * embedded web viewer, the page hosting it.
 *
 * `handleExportExe` is dual-purpose:
 *   - Electron portable build: appends current PDF bytes onto a copy of the
 *     running exe (the real "EXE Viewer" feature).
 *   - Web build: the feature can't run client-side, so we send the user to
 *     this version's installer on the GitHub release. It used to be
 *     `./release/…` next to the web app, which only a self-hosted server that
 *     uploaded the installer had; on GitHub Pages that link was a 404.
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
  getMarkdownText,
  currentPage = 1,
}: UseExportersArgs) {
  const [isExporting, setIsExporting] = useState(false)
  // What saved files are named after: the document — or for pictures the
  // collection (the folder's name), not whichever picture happened to be the
  // one double-clicked.
  const images = kind === 'image' ? pdfDoc?.images ?? null : null
  const baseName = images ? stripDocExt(images.name) : file ? stripDocExt(file.name) : 'document'

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

  /**
   * The document as "PDF 저장" writes it: annotations, OCR text and all,
   * locked with `password` when one is given.
   */
  const savedPdf = useCallback(async (password?: string): Promise<Blob> => {
    if (kind === 'pdf' && fileBytes) {
      const { exportPdf } = await import('../services/pdfExporter')
      // OCR results live only in memory; written into the file they survive
      // the save, so a scanned document comes back searchable.
      let textLayer
      if (pdfDoc && ocrResults && ocrResults.size > 0) {
        const { placeOcrWords } = await import('../services/ocrTextLayer')
        textLayer = await placeOcrWords(pdfDoc, ocrResults)
      }
      return exportPdf(fileBytes, annotations, {
        sourcePassword: documentPassword ?? undefined, password,
      }, textLayer)
    }
    // Non-PDF sources have no PDF to patch — build one from the rendered
    // pages (this is also the HWP→PDF converter).
    const bytes = await renderedPdf(password)
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
  }, [kind, fileBytes, pdfDoc, ocrResults, annotations, documentPassword, renderedPdf])

  /**
   * The document as it is now, under a name that says what it is: the file's
   * own bytes, or for Markdown the editor's text (saved or not), or for an
   * image collection the picture in view. The name is known at once (a save
   * picker must open while the click still counts); the bytes may need a read.
   */
  const currentDocument = useCallback((): { name: string; bytes: () => Promise<ArrayBuffer> } | null => {
    if (kind === 'md') {
      const text = getMarkdownText?.()
      if (text != null) {
        const encoded = new TextEncoder().encode(text)
        return { name: documentFileName(file?.name, kind, encoded), bytes: async () => encoded.slice().buffer }
      }
    }
    const images = pdfDoc?.images
    if (kind === 'image' && images) {
      const page = Math.min(Math.max(1, currentPage), images.entries.length)
      return { name: images.nameOf(page), bytes: async () => (await images.original(page)).bytes }
    }
    if (!fileBytes) return null
    return { name: documentFileName(file?.name, kind, fileBytes), bytes: async () => fileBytes }
  }, [kind, getMarkdownText, pdfDoc, currentPage, fileBytes, file])

  /**
   * What a viewer exe carries. The file itself — a deck stays a deck, a HWP a
   * HWP, a locked PDF still asks for its password — unless there is something
   * on it "PDF 저장" would keep and the original lacks: stamps, signatures and
   * other lasting marks, OCR text (PDF and images; a HWP has its own text), or
   * a password put on or taken off with the padlock. Then it is that PDF, so
   * the recipient sees what the sender saw.
   */
  const exeDocument = useCallback(async (): Promise<{ bytes: ArrayBuffer; name: string }> => {
    if (kind === 'pdf' || kind === 'hwp' || kind === 'image') {
      const marked = annotations.some(a => !isVolatile(a))
      const recognized = kind !== 'hwp'
        && [...(ocrResults?.values() ?? [])].some(r => r.status === 'done' && r.words.length > 0)
      const passwordChanged = (savePassword ?? null) !== (documentPassword ?? null)
      // Several pictures go as the one PDF they make together; one goes as itself.
      const collection = kind === 'image' && (pdfDoc?.images?.entries.length ?? 1) > 1
      if (marked || recognized || passwordChanged || collection) {
        const pdf = await savedPdf(savePassword ?? undefined)
        const name = images ? `${baseName}.pdf` : `${stripDocExt(documentFileName(file?.name, kind, fileBytes ?? new Uint8Array()))}.pdf`
        return { bytes: await pdf.arrayBuffer(), name }
      }
    }
    const doc = currentDocument()
    if (!doc) throw new Error(bytesUnavailable ?? t('doc.notReady'))
    return { name: doc.name, bytes: await doc.bytes() }
  }, [kind, annotations, ocrResults, savePassword, documentPassword, savedPdf, file, fileBytes, currentDocument, bytesUnavailable, pdfDoc, images, baseName])

  /** "원본 저장": the file itself, under another name or in another place. */
  const handleSaveOriginal = useCallback(async () => {
    if (!bytesReady()) return
    const doc = currentDocument()
    if (!doc) { onError(t('doc.notReady')); return }
    const ext = openableExt(doc.name)
    const target = await pickSaveTarget(doc.name, {
      description: t('export.originalType', { ext: ext.toUpperCase() }),
      accept: { 'application/octet-stream': [`.${ext}`] },
    })
    if (target.kind === 'canceled') return
    setIsExporting(true)
    try {
      if (await saveBlobTo(target, new Blob([await doc.bytes()]), doc.name)) {
        onSuccess(t('export.originalDone', { name: doc.name }))
      }
    } catch (err) {
      console.error('Saving the original failed:', err)
      onError(t('export.originalFailed', { error: errorMessage(err) }))
    } finally {
      setIsExporting(false)
    }
  }, [bytesReady, currentDocument, onSuccess, onError])

  /**
   * Markdown and mail as PDF: their text typeset the way the app prints it,
   * through the same Chromium print as Word and PowerPoint, so it stays text.
   * The web build has no printToPDF and opens the print dialog instead, whose
   * destinations include "Save as PDF" — as Office does there.
   */
  const saveFlowPdf = useCallback(async (): Promise<boolean> => {
    const doc = currentDocument()
    if (!doc) { onError(t('doc.notReady')); return false }
    const { canSaveOfficePdf } = await import('../services/officePdf')
    if (!canSaveOfficePdf()) {
      const { printFlowDoc } = await import('../services/htmlPrint')
      await printFlowDoc()
      return false
    }
    const outName = `${stripDocExt(doc.name)}.pdf`
    const target = await pickSaveTarget(outName, {
      description: 'PDF document', accept: { 'application/pdf': ['.pdf'] },
    })
    if (target.kind === 'canceled') return false
    setIsExporting(true)
    try {
      // The converter `topdf` uses, so the app and the console tool agree.
      const { documentToPdf } = await import('../services/cliBridge')
      const bytes = await documentToPdf(await doc.bytes(), doc.name)
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
      if (await saveBlobTo(target, blob, outName)) {
        onSuccess(t('export.pdfDone', { name: outName }))
        return true
      }
      return false
    } catch (err) {
      console.error('PDF export failed:', err)
      onError(t('export.pdfFailed', { error: errorMessage(err) }))
      return false
    } finally {
      setIsExporting(false)
    }
  }, [currentDocument, onSuccess, onError])

  /**
   * "책자 형태로 저장" — the two-page view as a PDF: each row of it on one sheet — two A4
   * pages side by side on A3 landscape, a wide page on a sheet of its own —
   * which is the layout a booklet is printed from. Built from exactly what
   * "PDF 저장" writes, then laid out; the password, if any, goes on last.
   *
   * It does not mark the document saved: it writes a different file, and the
   * document itself is as unsaved as before.
   */
  const handleExportSpreads = useCallback(async () => {
    if (!bytesReady()) return
    const password = savePassword ?? undefined
    const outName = `${baseName}_booklet.pdf`
    const target = await pickSaveTarget(outName, {
      description: 'PDF document', accept: { 'application/pdf': ['.pdf'] },
    })
    if (target.kind === 'canceled') return

    setIsExporting(true)
    try {
      const source = await (await savedPdf()).arrayBuffer()
      const { exportSpreads } = await import('../services/spreadExporter')
      const bytes = await exportSpreads(source, { password })
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
      if (await saveBlobTo(target, blob, outName)) {
        onSuccess(t('export.spreadDone', { name: outName }))
      }
    } catch (err) {
      console.error('Two-page PDF export failed:', err)
      onError(t('export.spreadFailed', { error: errorMessage(err) }))
    } finally {
      setIsExporting(false)
    }
  }, [bytesReady, savePassword, baseName, savedPdf, onSuccess, onError])

  /** Save as PDF. Resolves true once the file is written. */
  const handleExportPdf = useCallback(async (): Promise<boolean> => {
    if (kind === 'md' || kind === 'eml') return saveFlowPdf()
    if (!bytesReady()) return false
    const password = savePassword ?? undefined
    // The name says which of the three things happened, so the file is still
    // recognisable a week later.
    // Pictures saved as one PDF are just that PDF: nothing was "annotated".
    const suffix = password ? '_locked' : documentPassword ? '_unlocked' : images ? '' : '_annotated'
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
      const blob = await savedPdf(password)
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
  }, [kind, saveFlowPdf, bytesReady, savedPdf, documentPassword, savePassword, onSuccess, onError, onPdfSaved, images, baseName])

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
    const outName = `${baseName}.html`
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
  }, [bytesReady, viewerPdfBytes, kind, fileBytes, file, baseName, onSuccess, onError])

  const handleExportImages = useCallback(async () => {
    if (!pdfDoc) return
    const filename = images ? `${baseName}.pdf` : file?.name ?? 'document.pdf'
    const outName = `${baseName}_images.zip`
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
  }, [pdfDoc, numPages, file, images, baseName, onSuccess, onError])

  // EXE Viewer:
  //   - Electron: appends the document (see `exeDocument`) onto a copy of the
  //     portable exe. Main process owns the file dialog + write.
  //   - Web: sends the user to the installer on the GitHub release, so they
  //     can install the desktop app and use the real feature.
  const handleExportExe = useCallback(async () => {
    // Web fallback: just navigate to the installer download URL.
    if (!window.electronAPI) {
      const installerUrl = `https://github.com/whyzoo-lab/WZ-PDF/releases/download/v${__APP_VERSION__}/WZ_Reader_Setup_${__APP_VERSION__}.exe`
      const ok = window.confirm(t('export.exeWebPrompt'))
      if (ok) window.location.href = installerUrl
      return
    }
    if (!bytesReady()) return

    setIsExporting(true)
    // The first export downloads the portable it is made from (~130 MB) — say
    // how far along it is, every 10 %, or the wait reads as a hang.
    let shown = -1
    const stopProgress = window.electronAPI.onViewerTemplateProgress?.(percent => {
      const step = Math.floor(percent / 10) * 10
      if (step === shown) return
      shown = step
      onSuccess(t('export.exeDownloading', { percent: step }))
    })
    try {
      const doc = await exeDocument()
      const result = await window.electronAPI.exportExe(doc.bytes, doc.name)
      if (result.success) {
        onSuccess(t('export.exeDone'))
      } else if (!result.canceled) {
        onError(t('export.exeFailed', { error: result.error ?? t('export.exeUnknownError') }))
      }
    } catch (err) {
      console.error('EXE export error:', err)
      onError(t('export.exeError', { error: errorMessage(err) }))
    } finally {
      stopProgress?.()
      setIsExporting(false)
    }
  }, [bytesReady, exeDocument, onSuccess, onError])

  return {
    isExporting,
    handleSaveOriginal,
    handleExportPdf,
    handleExportSpreads,
    handleExportHtml,
    handleExportImages,
    handleExportExe,
  }
}
