import { useState, useCallback, useEffect, useLayoutEffect, useRef, lazy, Suspense, useMemo } from 'react'
import {
  type DocumentFile, EAGER_DOCUMENT_LIMIT_LABEL, EAGER_DOCUMENT_MAX_BYTES,
  isLargeDocument, pathFile, readAll,
} from './services/documentSource'
import { ActionBar } from './components/toolbar/ActionBar'
import type { WatermarkSettings } from './components/modals/WatermarkConfig'
import { usePdfDocument } from './hooks/usePdfDocument'
import { useAnnotations } from './hooks/useAnnotations'
import { useFitZoom } from './hooks/useFitZoom'
import { usePrint } from './hooks/usePrint'
import { useExporters } from './hooks/useExporters'
import { usePageOperations } from './hooks/usePageOperations'
import { useOcr } from './hooks/useOcr'
import { useSearch } from './hooks/useSearch'
import { useOpenUrl } from './hooks/useOpenUrl'
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts'
import { useFlowSearch } from './hooks/useFlowSearch'
import { useTts } from './hooks/useTts'
import { SpeechHighlight } from './components/SpeechHighlight'
import { TtsBar } from './components/TtsBar'
import { planSpeech } from './services/ttsText'
import { joinSpeechUnits, pagesForChunks, type SpeechUnit } from './services/speechPages'
import { SearchBar } from './components/SearchBar'
import { SpeechAnnouncer } from './components/SpeechAnnouncer'
import { PasswordPrompt } from './components/modals/PasswordPrompt'
import { PasswordSetPrompt } from './components/modals/PasswordSetPrompt'
import type { Annotation, OmitId, PendingStamp } from './types/annotation'
import type { AppMode, ViewMode } from './types/viewModes'
import { isFlowKind, isOfficeKind } from './types/viewerDoc'
import type { OfficePageInfo, OfficeViewHandle } from './components/office/officeView'
import { MIN_ZOOM, MAX_ZOOM, ZOOM_STEP, PAGE_ATTR } from './utils/constants'
import { classifyDocFile, DOCUMENT_ACCEPT } from './utils/detectDocType'
import { pickSaveTarget, saveBlobTo, stripDocExt } from './utils/download'
import { pageSuffix } from './utils/pageSuffix'
import { PagePanel } from './components/panel/PagePanel'
import { Toast } from './components/Toast'
import { VideoExportPanel, type VideoProgress } from './components/office/VideoExportPanel'
import { UpdateToast } from './components/UpdateToast'
import { useAutoUpdate } from './hooks/useAutoUpdate'
import { useStampLibrary } from './hooks/useStampLibrary'
import { customKey, type SavedStamp } from './services/stampLibrary'
import { ErrorBoundary } from './components/ErrorBoundary'
import { t } from './i18n'
import { isVolatile } from './types/annotation'
import { useEditHistory } from './hooks/useEditHistory'
import { UnsavedChangesDialog } from './components/modals/UnsavedChangesDialog'
import { StartScreen } from './components/StartScreen'
import { errorMessage } from './utils/errors'
import { loadPrivateMode, pickPrivateDocument, type PrivateMode } from './services/privateMode'

// Modals are loaded on demand to shrink the initial bundle.
// They only render when the user actively summons them, so the round-trip
// to fetch the chunk happens during otherwise-idle interaction time.
const SignaturePad     = lazy(() => import('./components/modals/SignaturePad').then(m => ({ default: m.SignaturePad })))
const WatermarkConfig  = lazy(() => import('./components/modals/WatermarkConfig').then(m => ({ default: m.WatermarkConfig })))
const OpenUrlModal     = lazy(() => import('./components/modals/OpenUrlModal').then(m => ({ default: m.OpenUrlModal })))
const PrintPreviewModal = lazy(() => import('./components/modals/PrintPreviewModal').then(m => ({ default: m.PrintPreviewModal })))

// The viewer subtree is the app's heaviest dependency cluster (Konva + the
// pdfjs TextLayer) and renders only once a document is open — so it is loaded
// on demand. Keeping it out of the entry chunk is what lets the window paint
// its toolbar immediately instead of waiting on ~700 KB of JS that an empty
// viewer never uses.
const importPdfViewer = () => import('./components/viewer/PdfViewer')
const PdfViewer = lazy(() => importPdfViewer().then(m => ({ default: m.PdfViewer })))
// Messages render outside the page pipeline; its chunk also carries the HTML
// sanitizer, so it only loads when a .eml is actually opened.
const EmailView = lazy(() => import('./components/email/EmailView').then(m => ({ default: m.EmailView })))
// Markdown also renders as a document rather than pages; its chunk carries the
// Markdown parser, so it only loads when a .md is opened.
const MarkdownView = lazy(() => import('./components/markdown/MarkdownView').then(m => ({ default: m.MarkdownView })))
const DocxView = lazy(() => import('./components/office/DocxView').then(m => ({ default: m.DocxView })))
const SheetView = lazy(() => import('./components/office/SheetView').then(m => ({ default: m.SheetView })))
const PptxView = lazy(() => import('./components/office/PptxView').then(m => ({ default: m.PptxView })))

/**
 * Pull the viewer chunks in as soon as the shell has painted.
 *
 * Deferring them fixed start-up, but it moved the cost rather than removing it:
 * the common desktop flow is "double-click a PDF", so the app booted fast and
 * then sat on the Suspense fallback while ~750 KB (viewer + pdfjs) downloaded —
 * a second, now-visible wait that felt slower than the old single one.
 *
 * Fetching them right after first paint gets both halves: the first frame still
 * only needs the entry chunk, and by the time a document is ready the modules
 * are already in the registry, so <Suspense> resolves without ever showing its
 * fallback. Fire-and-forget on purpose — a failure here is not an error, the
 * real import on the render path will surface it.
 */
function prefetchViewerChunks(): void {
  void importPdfViewer().catch(() => {})
  void import('pdfjs-dist').catch(() => {})
}

/** What Ctrl+C / Ctrl+V act on: things placed on a page, not markup or watermarks. */
const COPYABLE_ANNOTATIONS: ReadonlySet<string> = new Set(['stamp', 'signature', 'textEdit'])
/** How far a copy pasted onto its own page is moved off the original (PDF points). */
const PASTE_NUDGE = 12

/** A preset stamp's size until the reader resizes one (PDF points). */
const DEFAULT_PRESET_STAMP_SIZE = { width: 100, height: 40 }

/** How long "opening…" may stand in for the start screen at launch. */
const OPENING_AT_LAUNCH_DEADLINE_MS = 15_000

/** One query-string parameter of the page, or null. */
function queryParam(name: string): string | null {
  try { return new URLSearchParams(window.location.search).get(name) } catch { return null }
}

export default function App() {
  // ── Document state ────────────────────────────────────────────────────────
  const [file, setFile] = useState<DocumentFile | null>(null)
  const [fileBytes, setFileBytes] = useState<ArrayBuffer | null>(null)

  // ── View state ────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)       // 0 | 90 | 180 | 270
  const [appMode, setAppMode] = useState<AppMode>('viewer')
  // Embed mode (?embed in the URL): chrome-less read-only viewer for <iframe>
  // website embedding. Read once at startup.
  const [embed] = useState(() => {
    try { return new URLSearchParams(window.location.search).has('embed') } catch { return false }
  })
  // Private mode (services/privateMode.ts): the web viewer shows only what the
  // server's private.json designates, view only. Decided by a file on the
  // server, never by the address bar; never in the desktop app.
  const [privateMode, setPrivateMode] = useState<PrivateMode>(() =>
    window.electronAPI ? { status: 'off' } : { status: 'pending' })
  useEffect(() => {
    if (window.electronAPI) return
    let cancelled = false
    // Next to the page itself, not its <base>: the same thing on an ordinary
    // deployment, but it lets a copy of app.html in a sub-folder share the
    // parent's assets through <base href="../"> while carrying a config of its
    // own (the Pages site's private-mode demo, scripts/build-private-demo.cjs).
    void loadPrivateMode(window.location.href).then(mode => { if (!cancelled) setPrivateMode(mode) })
    return () => { cancelled = true }
  }, [])
  // Locked until the server has answered as well: a document dropped in that
  // moment would otherwise slip past a private deployment.
  const locked = privateMode.status !== 'off'
  const chromeless = embed || locked
  const canPrint = !locked || (privateMode.status === 'on' && privateMode.config.print)
  const [viewMode, setViewMode] = useState<ViewMode>('single')
  const [fullscreenLayout, setFullscreenLayout] = useState<'single' | 'spread'>('single')
  // First page shown in presentation mode: 1 for F5 and the toolbar button, the
  // page in view for Alt+F5.
  const [fullscreenStartPage, setFullscreenStartPage] = useState(1)
  const [scrollToPage, setScrollToPage] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [isPanelOpen, setIsPanelOpen] = useState(false)

  // ── Editing state (pending placement, modals) ─────────────────────────────
  const [pendingStamp, setPendingStamp] = useState<PendingStamp | null>(null)
  const [pendingSignature, setPendingSignature] = useState<string | null>(null)
  const [showSignaturePad, setShowSignaturePad] = useState(false)
  const [showWatermarkConfig, setShowWatermarkConfig] = useState(false)
  // Open while the reader is choosing a password for an encrypted export.
  const [askEncryptPassword, setAskEncryptPassword] = useState(false)

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
  // The viewer viewport — measured by useFitZoom so auto-fit uses real space.
  const mainRef = useRef<HTMLElement>(null)

  const {
    pdfDoc, numPages, isLoading, error, kind, email, markdown, office,
    passwordPrompt, submitPassword, cancelPassword, documentPassword,
  } = usePdfDocument(file)
  // A reflowing document is loaded and on screen. Guarded on the payload as
  // well as the kind so it is false during the load, when there is nothing to
  // zoom, print or present yet.
  const flowDoc = isFlowKind(kind) && (markdown !== null || email !== null || office !== null)
  // Word, PowerPoint and spreadsheets: what their view offers the toolbar
  // (fit width, page jumps, a PDF of the document), and — for the paged two —
  // which page is on screen.
  const officeHandleRef = useRef<OfficeViewHandle | null>(null)
  const [officePages, setOfficePages] = useState<OfficePageInfo | null>(null)
  const pagedOffice = office !== null && office.kind !== 'sheet' && officePages !== null
  // A deck's speaker notes under each slide; shown unless the reader hides them.
  const [showSlideNotes, setShowSlideNotes] = useState(true)
  const {
    annotations,
    selectedId,
    activeMode,
    addAnnotation: addAnnotationRaw,
    updateAnnotation: updateAnnotationRaw,
    removeAnnotation: removeAnnotationRaw,
    selectAnnotation,
    setActiveMode,
    remapAnnotations,
    clearMarkups: clearMarkupsRaw,
    replaceAnnotations,
  } = useAnnotations()

  // ── Undo / redo ───────────────────────────────────────────────────────────
  // One history over annotations and the document itself: a page edit swaps
  // `file` for the edited bytes, so restoring the old `file` undoes it. Every
  // change goes through the wrappers below, which record the state first.
  const editSnapshot = useMemo(() => ({ annotations, file }), [annotations, file])
  const restoreSnapshot = useCallback((snap: { annotations: Annotation[]; file: DocumentFile | null }) => {
    replaceAnnotations(snap.annotations)
    setFile(snap.file)
  }, [replaceAnnotations])
  const history = useEditHistory(editSnapshot, restoreSnapshot)
  const { record: recordEdit, reset: resetHistory } = history

  const addAnnotation = useCallback((a: OmitId<Annotation>) => {
    recordEdit()
    return addAnnotationRaw(a)
  }, [recordEdit, addAnnotationRaw])
  // Saved stamps ("내 도장"), loaded once the editor is switched on.
  const stampLibrary = useStampLibrary(appMode === 'editor')
  const { rememberSize: rememberStampSize } = stampLibrary
  const annotationsRef = useRef(annotations)
  useLayoutEffect(() => { annotationsRef.current = annotations })
  const updateAnnotation = useCallback((id: string, updates: Partial<Annotation>) => {
    recordEdit()
    updateAnnotationRaw(id, updates)
    // Resizing a stamp sets that stamp's size from now on: the next one placed
    // (the tool stays armed) and every later use come out the same size.
    const target = annotationsRef.current.find(a => a.id === id)
    if (target?.type === 'stamp' && target.presetId && updates.width !== undefined && updates.height !== undefined) {
      const size = { width: updates.width, height: updates.height }
      const key = target.presetId
      setPendingStamp(p => (p && p.presetId === key ? { ...p, ...size } : p))
      void rememberStampSize(key, size)
    }
  }, [recordEdit, updateAnnotationRaw, rememberStampSize])
  const removeAnnotation = useCallback((id: string) => {
    recordEdit()
    removeAnnotationRaw(id)
  }, [recordEdit, removeAnnotationRaw])
  const clearMarkups = useCallback(() => {
    if (!annotations.some(isVolatile)) return
    recordEdit()
    clearMarkupsRaw()
  }, [annotations, recordEdit, clearMarkupsRaw])

  // ── Unsaved changes ───────────────────────────────────────────────────────
  // What was last opened or saved, compared by identity: annotations are
  // immutable and a page edit replaces `file`, so "changed" is a reference
  // comparison. Pen and rectangle never reach a saved file, so they don't count.
  const [savedState, setSavedState] = useState<{ file: DocumentFile | null; annotations: readonly Annotation[] }>({ file: null, annotations: [] })
  const lastingAnnotations = useMemo(() => annotations.filter(a => !isVolatile(a)), [annotations])
  const [markdownDirty, setMarkdownDirty] = useState(false)
  const unsaved = file !== null && (
    markdownDirty
    || file !== savedState.file
    || lastingAnnotations.length !== savedState.annotations.length
    || lastingAnnotations.some((a, i) => a !== savedState.annotations[i])
  )
  const markSaved = useCallback(() => {
    setSavedState({ file, annotations: lastingAnnotations })
  }, [file, lastingAnnotations])
  const markdownSaveRef = useRef<(() => Promise<boolean>) | null>(null)

  // Why there are no bytes to save from, when that is not just "still reading".
  const bytesUnavailable = file && isLargeDocument(file)
    ? t('doc.tooLargeToEdit', { limit: EAGER_DOCUMENT_LIMIT_LABEL })
    : null
  // Adding, deleting and reordering pages rewrite a PDF with pdf-lib. A HWP or
  // an image has no PDF to rewrite: handing its bytes over failed with "Failed
  // to parse PDF document … No PDF header found". Stamps, signatures and
  // watermarks still work on those pages (they are saved into a PDF), so the
  // edit switch stays; only the page tools are withheld.
  const pagesEditable = kind === 'pdf'
  const pageEditUnavailable = bytesUnavailable ?? (pagesEditable ? null : t('panel.pdfOnly'))

  // ── Hooks: feature bundles ────────────────────────────────────────────────
  const { fitWidth } = useFitZoom({ pdfDoc, viewMode, rotation, setZoom, viewportRef: mainRef })

  /**
   * What the next save should do about a password: a string puts one on, null
   * saves unlocked. The padlock only edits this — nothing is written until the
   * reader saves — so setting a password and choosing where the file goes stay
   * two separate decisions.
   *
   * Keyed to the document it was chosen for, like the Markdown edit buffer, so
   * opening another file reseeds it without an effect that would setState after
   * render. The default is the password the document arrived with: one that
   * came locked stays locked unless the reader says otherwise.
   */
  const [chosenPassword, setChosenPassword] =
    useState<{ from: string | null; value: string | null }>({ from: null, value: null })

  const savePassword = chosenPassword.from === documentPassword
    ? chosenPassword.value
    : documentPassword
  const update = useAutoUpdate()
  const ocr = useOcr(pdfDoc, numPages)
  // Declared with the other feature hooks, not down with the speech wiring,
  // because opening a document has to be able to stop it.
  const tts = useTts()
  const search = useSearch(pdfDoc, numPages, (page) => {
    const r = ocr.ocrResults.get(page)
    return r && r.status === 'done' ? r.words.map(w => w.text) : undefined
  })
  // Find-in-document comes in two flavours because the documents do: pdfjs text
  // items for pages, live DOM for the reflowing formats. `findBar` picks the one
  // that matches what is open, so the SearchBar itself stays format-agnostic.
  const flowSearch = useFlowSearch(flowDoc)
  const { handlePrint, isPrinting, printProgress, previewPages, confirmPrint, cancelPrint } = usePrint({ pdfDoc, numPages, annotations, onError: showToast })
  const {
    isExporting,
    handleExportPdf,
    handleExportSpreads,
    handleExportHtml,
    handleExportImages,
    handleExportExe,
  } = useExporters({
    file, fileBytes, pdfDoc, numPages, annotations, kind, documentPassword, savePassword,
    ocrResults: ocr.ocrResults,
    bytesUnavailable, onSuccess: showToast, onError: showToast, onPdfSaved: markSaved,
  })

  // The padlock decides *what saving will do*; it does not save. Otherwise one
  // click meant both "put a password on this" and "write a file now", and there
  // was no way to change your mind about the first without doing the second.
  const handlePassword = useCallback(() => {
    if (savePassword) {
      setChosenPassword({ from: documentPassword, value: null })
      showToast(t('password.willRemove'))
      return
    }
    setAskEncryptPassword(true)
  }, [savePassword, documentPassword, showToast])

  // Page CRUD ops: when one succeeds we rewrite `file`, remap annotations,
  // and jump the viewer back to page 1 (the user's edits change the layout
  // so previous scroll position is meaningless).
  const handlePageOpResult = useCallback((newBytes: ArrayBuffer, pageMapping: Map<number, number>) => {
    recordEdit()
    remapAnnotations(pageMapping)
    const name = file?.name ?? 'document.pdf'
    setFile(new File([newBytes], name, { type: 'application/pdf' }))
    setCurrentPage(1)
    setScrollToPage(1)
  }, [recordEdit, remapAnnotations, file])

  const {
    isPageOperating,
    handleDeletePages,
    handleInsertBlankPage,
    handleInsertFromPdf,
    handleReorderPages,
  } = usePageOperations({
    fileBytes, documentPassword, bytesUnavailable: pageEditUnavailable, onResult: handlePageOpResult,
    onError: err => showToast(errorMessage(err)),
  })

  // ── Warm the viewer chunks once the shell is on screen ────────────────────
  // See prefetchViewerChunks: this is what stops "open a PDF" from paying a
  // second download. Scheduled off the critical path so it never competes with
  // the first paint, but early enough to win the race against the user.
  useEffect(() => {
    const ric = window.requestIdleCallback
    if (ric) {
      const id = ric(() => prefetchViewerChunks(), { timeout: 1500 })
      return () => window.cancelIdleCallback?.(id)
    }
    const t = window.setTimeout(prefetchViewerChunks, 200) // Safari / older WebKit
    return () => window.clearTimeout(t)
  }, [])

  // ── Window title + raw bytes ───────────────────────────────────────────────
  useEffect(() => {
    if (!file) {
      // Resetting derived state when the source `file` prop clears is the
      // intended use of an effect here, not a render-cascade bug.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFileBytes(null)
      document.title = 'WZ Reader'
      return
    }
    // Too large to hold: it is paged in by range for viewing, so there are no
    // bytes to keep for saving. Said now, rather than at the first save.
    if (isLargeDocument(file)) {
      setFileBytes(null)
      showToast(t('doc.tooLargeToEdit', { limit: EAGER_DOCUMENT_LIMIT_LABEL }))
      return
    }
    let cancelled = false
    readAll(file)
      .then(buf => { if (!cancelled) setFileBytes(buf) })
      // A file removed or rewritten after it was picked. Without this the
      // bytes stayed null and every later save silently did nothing.
      .catch((err: unknown) => {
        if (!cancelled) showToast(t('error.openFailed', { error: err instanceof Error ? err.message : String(err) }))
      })
    return () => { cancelled = true }
  }, [file, showToast])

  // Window title — marked while there are unsaved changes, as editors do.
  useEffect(() => {
    document.title = file ? `${unsaved ? '● ' : ''}WZ Reader - ${file.name}` : 'WZ Reader'
  }, [file, unsaved])

  // ── Ctrl+scroll → zoom ────────────────────────────────────────────────────
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !(pdfDoc || flowDoc) || viewMode === 'fullscreen' || viewMode === 'grid') return
      e.preventDefault()
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
      setZoom(z => +(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)).toFixed(2)))
    }
    // On <main>, not window: a non-passive wheel listener makes every scroll
    // wait for the handler, and only the document area needs preventDefault.
    const el = mainRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [pdfDoc, flowDoc, viewMode])

  // ── Scroll-pin guard ──────────────────────────────────────────────────────
  // The app shell (documentElement / body / #root / <main>) must never scroll —
  // only the inner PDF container does. But browser behaviours like
  // scrollIntoView on a focused input, a selected text node, or a clicked
  // annotation can scroll an overflow-hidden ancestor *programmatically*,
  // which pushes the ActionBar off-screen and spawns a phantom window
  // scrollbar. This capture-phase listener resets any such stray scroll to 0
  // the instant it happens, regardless of the trigger.
  // Tag the root element when running inside Electron so CSS can opt in to
  // window-drag regions and reserve space for the OS title-bar overlay.
  useEffect(() => {
    if (window.electronAPI) document.documentElement.classList.add('is-electron')
  }, [])

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

  // ── Surface OCR engine errors as a Toast ──────────────────────────────────
  useEffect(() => {
    if (ocr.ocrError) {
      // Keep the localized headline but append the underlying cause so failures
      // on platforms we can't easily inspect (e.g. iOS Safari) are diagnosable.
      const prefix = 'OCR engine failed to load: '
      const detail = ocr.ocrError.startsWith(prefix) ? ocr.ocrError.slice(prefix.length) : ocr.ocrError
      // eslint-disable-next-line react-hooks/set-state-in-effect -- surfacing an engine error as a toast is the effect's purpose
      showToast(`${t('ocr.engineError')}: ${detail}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocr.ocrError])

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
    // One scroller per navigation. When the match's page is already rendered in
    // single view, PdfTextLayer has just started a smooth scroll to the match
    // itself (child effects run before this one). Jumping to the page as well
    // started a second smooth scroll 50 ms later that cancelled it — traced:
    // scrollIntoView at 4 ms, scrollBy at 62 ms, view back at the page top. Zoomed
    // in, 27 of 40 "next" presses left the match off screen. Only a page whose
    // text layer is not there yet needs the jump; once it mounts, the layer
    // scrolls to the match.
    if (document.querySelector(`#pdf-single-container #pdf-page-${activeMatchPage} .wz-search-hl-active`)) return
    setScrollToPage(activeMatchPage)
  }, [activeMatchPage, search.activeIndex])

  // ── File loading ──────────────────────────────────────────────────────────

  /** Reset state and load a PDF File object into the viewer. */
  // These hooks return a fresh object every render; only their member functions
  // are stable. Depending on the objects re-registered the Electron open-file
  // listeners and the global keydown listener on every render.
  const clearSearch = search.clear
  const clearFlowSearch = flowSearch.clear
  const stopTts = tts.stop
  const openDocument = useCallback((f: DocumentFile, filePath?: string) => {
    setFile(f)
    // Listed on the start screen next time. Paths only, and only files that
    // came from disk (not URLs, attachments or an embedded viewer's bytes).
    if (filePath) void window.electronAPI?.addRecentFile?.(filePath).catch(() => {})
    // A new document starts clean: no annotations carried over from the last
    // one (they used to be — the previous file's stamps landed on the same
    // page numbers of the next), no history to undo into it, nothing unsaved.
    replaceAnnotations([])
    resetHistory()
    setSavedState({ file: f, annotations: [] })
    setMarkdownDirty(false)
    setActiveMode(null)
    setPendingStamp(null)
    setPendingSignature(null)
    setRotation(0)
    setViewMode('single')
    setShowSearch(false)
    clearSearch()
    clearFlowSearch()
    // Reading belongs to the document that was open. Left running it keeps
    // speaking the old text over the new document, and the highlight hunts for
    // sentences that are no longer on screen.
    stopTts()
  }, [setActiveMode, clearSearch, clearFlowSearch, stopTts, replaceAnnotations, resetHistory])

  // Opening another document over unsaved changes asks first. Read through a
  // ref so the open-file listeners registered with this callback don't have to
  // be re-registered every time the document is edited.
  const unsavedRef = useRef(unsaved)
  useLayoutEffect(() => { unsavedRef.current = unsaved })
  // What waits on the "save / don't save / cancel" answer: opening another
  // document, or restarting to install an update.
  const [pendingLeave, setPendingLeave] = useState<{ reason: 'open' | 'update'; proceed: () => void } | null>(null)
  // Every way of opening a document ends here — a picked or dropped file,
  // `?url=`, a mail attachment — so this is where private mode refuses them.
  // The designated document is opened through `openDocument` directly.
  const lockedRef = useRef(locked)
  useLayoutEffect(() => { lockedRef.current = locked })
  const loadPdfFile = useCallback((f: DocumentFile, filePath?: string) => {
    if (lockedRef.current) { showToast(t('private.cannotOpen')); return }
    if (unsavedRef.current) setPendingLeave({ reason: 'open', proceed: () => openDocument(f, filePath) })
    else openDocument(f, filePath)
  }, [openDocument, showToast])

  // Restart to install a downloaded update. Unsaved work is settled first: the
  // installer is started before the app quits and closes it regardless, so the
  // window-close prompt would come too late to save anything. `leavingRef`
  // then lets the window go without asking again.
  const leavingRef = useRef(false)
  const { install: installUpdate } = update
  const restartToUpdate = useCallback(() => {
    const go = () => {
      leavingRef.current = true
      installUpdate().then(started => { if (!started) leavingRef.current = false }, () => { leavingRef.current = false })
    }
    if (unsavedRef.current) setPendingLeave({ reason: 'update', proceed: go })
    else go()
  }, [installUpdate])

  /** Main upload handler — accepts PDF and HWP/HWPX files. */
  const handleUpload = useCallback((f: File) => {
    if (!classifyDocFile(f).supported) {
      showToast(t('error.pdfOnly'))
      return
    }
    loadPdfFile(f, window.electronAPI?.pathForFile?.(f) || undefined)
  }, [loadPdfFile, showToast])

  /**
   * Open a document by path — the OS handing one over, or a recent document on
   * the start screen. Resolves false when it could not be opened.
   */
  const openPath = useCallback(async (filePath: string): Promise<boolean> => {
    const api = window.electronAPI
    if (!api) return false
    try {
      // Size first. A document too large to hold is paged in by range rather
      // than copied whole into this process — reading it whole is what used
      // to fail at 500 MB (see services/documentSource).
      const { size } = await api.statFile(filePath)
      if (size > EAGER_DOCUMENT_MAX_BYTES) {
        loadPdfFile(pathFile(filePath, size), filePath)
        return true
      }
      const data = await api.readFile(filePath)
      const name = filePath.split(/[/\\]/).pop() ?? 'document.pdf'
      // No MIME type: the name carries the extension and detectDocType reads
      // the bytes anyway. Hard-coding application/pdf mislabelled every
      // non-PDF the OS handed us.
      loadPdfFile(new File([data], name), filePath)
      return true
    } catch (err) {
      console.error('Failed to open file:', err)
      showToast(t('error.openFailed', { error: errorMessage(err) }))
      return false
    }
  }, [loadPdfFile, showToast])

  // ── Open from URL (+ embed ?url= auto-open) ───────────────────────────────
  const { showUrlModal, setShowUrlModal, urlLoading, urlError, handleOpenUrl } =
    useOpenUrl(loadPdfFile, showToast, privateMode.status === 'off')

  // ── Private mode: the one document the server designates ──────────────────
  const privateDocument = useMemo(() => {
    if (privateMode.status !== 'on') return null
    return pickPrivateDocument(privateMode.config, queryParam('doc'))
  }, [privateMode])
  const [privateLoadError, setPrivateLoadError] = useState<string | null>(null)
  useEffect(() => {
    if (!privateDocument) return
    let cancelled = false
    fetch(privateDocument.url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .then(bytes => { if (!cancelled) openDocument(new File([bytes], privateDocument.name)) })
      .catch(err => {
        if (!cancelled) setPrivateLoadError(t('private.loadFailed', { error: errorMessage(err) }))
      })
    return () => { cancelled = true }
  }, [privateDocument, openDocument])
  const privateMessage = privateMode.status === 'error' ? t('private.configFailed')
    : privateMode.status === 'on' && !privateDocument ? t('private.unknownDocument')
      : privateLoadError
  // Printing is "save as PDF" as well, so where it is not allowed the browser's
  // own print of the page comes out blank (index.css).
  useEffect(() => {
    if (canPrint) return
    document.documentElement.setAttribute('data-wz-no-print', '')
    return () => document.documentElement.removeAttribute('data-wz-no-print')
  }, [canPrint])

  // ── Electron: open-file (file association / CLI arg) ──────────────────────
  // Launched with a document (`?open=1`, set by the main process): the path
  // only arrives once the page has loaded, and reading the file takes a moment
  // more. The start screen used to flash up for that whole time, so until the
  // open settles the window says "opening…" instead. A deadline keeps a lost
  // message from leaving it there.
  const [openingAtLaunch, setOpeningAtLaunch] = useState(() => {
    try { return new URLSearchParams(window.location.search).has('open') } catch { return false }
  })
  useEffect(() => {
    if (!openingAtLaunch) return
    const id = window.setTimeout(() => setOpeningAtLaunch(false), OPENING_AT_LAUNCH_DEADLINE_MS)
    return () => window.clearTimeout(id)
  }, [openingAtLaunch])
  useEffect(() => {
    const cleanup = window.electronAPI?.onOpenFile(filePath => {
      void openPath(filePath).finally(() => setOpeningAtLaunch(false))
    })
    return () => { cleanup?.() }
  }, [openPath])

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
      // Editing is page work — reordering, inserting, deleting — so bring the
      // page list out with the tools. Only opened on the way IN: leaving editor
      // keeps whatever the user last chose, so a manual close isn't undone.
      setIsPanelOpen(true)
    }
  }, [])

  /** Presentation mode, opening on `startPage` in the layout the reader was in. */
  const enterFullscreen = useCallback((startPage: number) => {
    prevViewModeRef.current = viewMode
    setFullscreenLayout(viewMode === 'spread' ? 'spread' : 'single')
    setFullscreenStartPage(startPage)
    setViewMode('fullscreen')
  }, [viewMode])

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    if (mode === 'fullscreen') enterFullscreen(1)
    else setViewMode(mode)
  }, [enterFullscreen])

  const handleGridPageClick = useCallback((pageNumber: number) => {
    setScrollToPage(pageNumber)
    setViewMode('single')
  }, [])

  const handleFullscreenExit = useCallback(() => {
    setViewMode(prevViewModeRef.current)
  }, [])

  // ── Reflowing documents (Markdown, mail) ──────────────────────────────────
  // They have no pages, so `useFitZoom` never runs for them and they would
  // inherit whatever the last PDF was fitted to — often ~0.5, which renders the
  // text microscopic. Reset when the kind changes; opening a second Markdown
  // file keeps the size the reader chose.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting display state on a document-kind change
    if (isFlowKind(kind)) setZoom(1)
  }, [kind])

  // Ctrl+P / the toolbar print button. The page-based path in `usePrint`
  // rasterises pages and can't do anything here, so reflowing documents print
  // their DOM instead — see services/htmlPrint.ts for why that's the better
  // output, not just the easier one.
  const handlePrintAny = useCallback(async () => {
    // Word, PowerPoint, sheets: printed on the paper their PDF uses — a slide
    // per sheet at the slide's size, Word pages at their own size and margins.
    const officeView = officeHandleRef.current
    if (isOfficeKind(kind) && officeView) {
      const { printOfficeJob } = await import('./services/officePdf')
      const job = await officeView.pdfJob()
      if (job.pieces === 1) { await printOfficeJob(job); return }
      // Too many rows for one print layout; the rows on screen are printed,
      // and the PDF save is the way to all of them.
      showToast(t('office.printLarge'))
    }
    if (isFlowKind(kind)) {
      const { printFlowDoc } = await import('./services/htmlPrint')
      if (await printFlowDoc()) return
    }
    handlePrint()
  }, [kind, handlePrint, showToast])

  useEffect(() => {
    if (!isFlowKind(kind)) return
    const onPrint = () => { handlePrintAny() }
    document.addEventListener('wz-print', onPrint)
    return () => document.removeEventListener('wz-print', onPrint)
  }, [kind, handlePrintAny])

  const handleRotateLeft = useCallback(() => {
    // +270 rather than -90: the modulo of a negative number is negative in JS,
    // which would leave rotation at -90 and break every `rotation === 90` test.
    setRotation(r => (r + 270) % 360)
  }, [])

  const handleRotate = useCallback(() => {
    setRotation(r => (r + 90) % 360)
  }, [])

  // ── Annotation helpers ────────────────────────────────────────────────────
  /** Arm the stamp tool. It stays armed after each stamp until Esc or 선택. */
  const armStamp = useCallback((stamp: PendingStamp) => {
    setPendingStamp(stamp)
    setActiveMode('stamp')
    showToast(t('stamp.armed'))
  }, [setActiveMode, showToast])

  const { presetSize, upload: uploadStamp, remove: removeSavedStamp } = stampLibrary
  const handleStampSelect = useCallback(async (src: string, presetId?: string) => {
    const size = (presetId && await presetSize(presetId).catch(() => null)) || DEFAULT_PRESET_STAMP_SIZE
    armStamp({ src, presetId, ...size })
  }, [armStamp, presetSize])

  const handleSavedStampSelect = useCallback((stamp: SavedStamp) => {
    armStamp({ src: stamp.src, presetId: customKey(stamp.id), width: stamp.width, height: stamp.height })
  }, [armStamp])

  /** An uploaded image joins "내 도장" and is armed straight away. */
  const handleStampUpload = useCallback(async (f: File) => {
    try {
      handleSavedStampSelect(await uploadStamp(f))
    } catch (err) {
      showToast(t('stamp.uploadFailed', { error: errorMessage(err) }))
    }
  }, [uploadStamp, handleSavedStampSelect, showToast])

  const handleAnnotationAdd = useCallback((annotation: OmitId<Annotation>) => {
    addAnnotation(annotation)
    // Pen / rectangle are volatile — stay in drawing mode for continuous strokes.
    if (isVolatile(annotation)) return
    // A stamp keeps the tool armed, like Adobe's: the next click stamps again,
    // on this page or the next. The stamp just placed is selected (addAnnotation
    // does that), so it can be resized at once — and that size is kept.
    // (addAnnotation keeps the mode for a stamp; setActiveMode here would
    // also clear the selection and hide the new stamp's resize handles.)
    if (annotation.type === 'stamp') return
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
  const handleZoomSet   = useCallback((z: number) => setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +z.toFixed(2)))), [])

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

  // Double-clicking the empty viewer opens a file — but only when nothing is
  // open. It used to test `pdfDoc` alone, and Markdown and mail have none, so a
  // double-click meant to select a word in them threw up the file picker.
  // `!file` too: between picking a document and its loader reporting in there
  // is a render with no document and no loading flag, and the start screen
  // flashed up in it.
  const nothingOpen = !file && !pdfDoc && !email && markdown === null && !office && !isLoading && !error && !chromeless
  const handleMainDoubleClick = useCallback(() => {
    if (nothingOpen) fileInputRef.current?.click()
  }, [nothingOpen])

  // Ctrl+drag region OCR (in PdfPage) hands back the recognized text → clipboard.
  const handleRegionCopy = useCallback((text: string) => {
    if (!text) { showToast(t('region.noText')); return }
    navigator.clipboard?.writeText(text).then(
      () => showToast(t('region.copied')),
      () => showToast(t('region.copyFailed')),
    )
  }, [showToast])

  // One shape for the find bar, whichever engine is behind it. The DOM search
  // is synchronous, so it has no "searching" state to report.
  const findBar = flowDoc
    ? { ...flowSearch, isSearching: false }
    : {
        total: search.matches.length,
        activeIndex: search.activeIndex,
        isSearching: search.isSearching,
        run: search.run,
        next: search.next,
        prev: search.prev,
        clear: search.clear,
      }

  // ── Read aloud ───────────────────────────────────────────────────────────
  const [ttsPromptOpen, setTtsPromptOpen] = useState(false)
  // Set while a narrated video is being made (handleSaveSlideVideo); aborts it.
  const videoAbort = useRef<AbortController | null>(null)

  /** Read from the page in view to the end — where the reader actually is. */
  // The page each planned sentence came from (services/speechPages.ts), for
  // the follow effect below; null where the text has no pages.
  const [speechPages, setSpeechPages] = useState<number[] | null>(null)
  const startReading = useCallback(async () => {
    let raw = ''
    // Text by page, where there are pages: what lets a presentation turn the
    // page as it is read (see the follow effect below).
    let units: SpeechUnit[] | null = null
    // A deck with a script is read from the script (its speaker notes), from
    // the slide on screen on — see OfficeViewHandle.speechScript.
    const script = flowDoc ? officeHandleRef.current?.speechScript?.() ?? null : null
    if (script) {
      units = script
      // The highlight follows the sentence in the notes under each slide, so
      // they must be on screen to follow.
      setShowSlideNotes(true)
    } else if (flowDoc) {
      // The element the flow printer marks is exactly the readable body.
      const body = document.querySelector<HTMLElement>('[data-wz-flow-print]')
      const { textFromElement } = await import('./services/ttsSource')
      raw = body ? textFromElement(body) : ''
    } else if (pdfDoc) {
      const { speechUnitsFromPages } = await import('./services/ttsSource')
      units = await speechUnitsFromPages(pdfDoc, kind, { from: currentPage, to: numPages }, {
        // A scanned page has an empty text layer; whatever OCR already
        // recognized there is the only thing there is to read.
        ocrRuns: page => {
          const result = ocr.ocrResults.get(page)
          return result && result.status === 'done' ? result.words : undefined
        },
      })
    }

    if (units) raw = joinSpeechUnits(units)
    const { chunks } = planSpeech(raw)
    if (chunks.length === 0) {
      // A scanned page is the common case here, and "nothing to read" is a
      // dead end unless it also says what to do about it.
      const scanned = !flowDoc && ocr.ocrResults.size === 0
      showToast(t(scanned ? 'tts.needsOcr' : 'tts.noText'))
      return
    }
    setSpeechPages(units ? pagesForChunks(units, chunks) : null)
    await tts.speak(chunks)
  }, [tts, flowDoc, pdfDoc, kind, currentPage, numPages, showToast, ocr.ocrResults])

  // ── A presentation turns the page as it is read ───────────────────────────
  // Outside fullscreen the view follows the highlight, which finds the
  // sentence on screen. A presentation shows one page or slide, and what is
  // being read is usually not on it (a deck's notes, the next PDF page), so it
  // follows the page each sentence was gathered from instead.
  const spokenPage = tts.status !== 'idle' && speechPages && tts.index >= 0
    ? speechPages[tts.index] ?? null
    : null
  const presentFollowPage = viewMode === 'fullscreen' ? spokenPage : null
  useEffect(() => {
    // Slides: the slideshow is the Office view's; PDFs follow through
    // PdfViewer's `fullscreenFollowPage`.
    if (presentFollowPage !== null && office) officeHandleRef.current?.goTo(presentFollowPage)
  }, [presentFollowPage, office])

  const reportSpeechFailure = useCallback((err: unknown) => {
    console.error('read-aloud failed:', err)
    showToast(t('tts.failed', { error: err instanceof Error ? err.message : String(err) }))
  }, [showToast])

  const handleToggleSpeech = useCallback(async () => {
    if (tts.status !== 'idle') { tts.stop(); return }
    // A narrated video is using the voice; reading as well would take turns
    // with it sentence by sentence and slow both.
    if (videoAbort.current) return
    try {
      // Checked here rather than on mount: sixteen stat() calls do not belong
      // on the startup path for a feature most sessions never touch.
      const status = await tts.refreshModel()
      if (!status?.ready) { setTtsPromptOpen(true); return }
      await startReading()
    } catch (err) {
      // Reached from a button, a key and the bar; an IPC or chunk-load failure
      // used to be an unhandled rejection and a button that seemed dead.
      reportSpeechFailure(err)
    }
  }, [tts, startReading, reportSpeechFailure])

  const handleTtsDownload = useCallback(async () => {
    try {
      await tts.download()
      setTtsPromptOpen(false)
      // Carry on into what the user actually asked for. Stopping here leaves
      // them staring at a finished download with nothing happening, having to
      // press the button a second time to get the thing they already requested.
      const status = await tts.refreshModel()
      if (status?.ready) await startReading()
    } catch (err) {
      setTtsPromptOpen(false)
      reportSpeechFailure(err)
    }
  }, [tts, startReading, reportSpeechFailure])

  /**
   * Save the pages selected in the panel as a new PDF.
   *
   * The destination is chosen FIRST, before the document is built. Picking a
   * file needs transient user activation — the permission the click granted,
   * which expires in a few seconds — and building a PDF out of a long document
   * can easily outlive it. See utils/download.ts.
   */
  const handleSavePages = useCallback(async (pageNums: number[]) => {
    if (pageNums.length === 0) return
    if (!fileBytes) {
      if (bytesUnavailable) showToast(bytesUnavailable)
      return
    }
    const suggested = `${stripDocExt(file?.name ?? 'document')}${pageSuffix(pageNums)}.pdf`

    const target = await pickSaveTarget(suggested, {
      description: 'PDF document',
      accept: { 'application/pdf': ['.pdf'] },
    })
    if (target.kind === 'canceled') return

    try {
      const { extractPages } = await import('./services/pdfPageService')
      const bytes = await extractPages(fileBytes, pageNums, documentPassword ?? undefined)
      const saved = await saveBlobTo(target, new Blob([bytes], { type: 'application/pdf' }), suggested)
      if (saved) showToast(t('panel.savedSelected', { n: pageNums.length }))
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    }
  }, [fileBytes, file, documentPassword, bytesUnavailable, showToast])

  // ── Word / PowerPoint / spreadsheet → PDF ──────────────────────────────────
  // The view lays its document out for paper (OfficeViewHandle.pdfJob) and the
  // main process prints that to PDF — text stays text. The web build has no
  // printToPDF, so it opens the print dialog on the same layout, where "Save as
  // PDF" is one of the destinations.
  const [savingOfficePdf, setSavingOfficePdf] = useState(false)
  // A ref, not the state: Ctrl+S held down, or pressed twice, must not start
  // a second save before the first has rendered its "saving" state — two
  // print layouts in the page at once each printed both documents.
  const officeSaveBusy = useRef(false)
  const saveOfficePdf = useCallback(async (view: OfficeViewHandle): Promise<boolean> => {
    const { canSaveOfficePdf, officeJobToPdf, printOfficeJob } = await import('./services/officePdf')
    if (!canSaveOfficePdf()) {
      await printOfficeJob(await view.pdfJob())
      return false
    }
    const suggested = `${stripDocExt(file?.name ?? 'document')}.pdf`
    // Asked first, while the click still counts as the reader's: a large
    // document can take longer to print than that permission lasts.
    const target = await pickSaveTarget(suggested, {
      description: 'PDF document',
      accept: { 'application/pdf': ['.pdf'] },
    })
    if (target.kind === 'canceled') return false
    setSavingOfficePdf(true)
    try {
      const job = await view.pdfJob()
      let lastShown = -1
      const bytes = await officeJobToPdf(job, fraction => {
        const percent = Math.floor(fraction * 100)
        if (job.pieces > 1 && percent < 100 && percent >= lastShown + 10) {
          lastShown = percent
          showToast(t('office.pdfProgress', { percent }))
        }
      })
      const saved = await saveBlobTo(target, new Blob([bytes as BlobPart], { type: 'application/pdf' }), suggested)
      if (saved) showToast(t('office.pdfSaved', { name: suggested }))
      return saved
    } catch (err) {
      console.error('Office PDF save failed:', err)
      showToast(t('office.pdfFailed', { error: errorMessage(err) }))
      return false
    } finally {
      setSavingOfficePdf(false)
    }
  }, [file, showToast])
  // ── A deck with speaker notes, recorded as a narrated video ─────────────────
  // services/slideVideo.ts makes it; this asks where, shows progress, saves.
  const [videoProgress, setVideoProgress] = useState<VideoProgress | null>(null)
  const canMakeVideo = office?.kind === 'pptx' && !!officePages?.hasNotes && !chromeless
    && !!window.electronAPI?.ttsSynthesizeBatch && !!window.electronAPI?.printToPdf && !!window.electronAPI?.pickVideoPath
  const handleSaveSlideVideo = useCallback(async () => {
    const view = officeHandleRef.current
    const api = window.electronAPI
    // Busy from the first moment: a second press while the save dialog was
    // still open used to ask for a second dialog ("File picker already active").
    if (!view || office?.kind !== 'pptx' || !api?.pickVideoPath || !api.writeVideoFile || videoAbort.current) return
    const controller = new AbortController()
    videoAbort.current = controller
    try {
      // The voice must be there before anything else is asked.
      try {
        const status = await tts.refreshModel()
        if (!status?.ready) { setTtsPromptOpen(true); return }
      } catch (err) {
        reportSpeechFailure(err)
        return
      }
      // The reader names the .mp4 in the app's own save dialog — one file, the
      // subtitles inside it. Asked before the long work, so the reader is not
      // kept waiting to be asked.
      const target = await api.pickVideoPath(`${stripDocExt(file?.name ?? 'presentation')}.mp4`)
      if (!target) return

      if (tts.status !== 'idle') tts.stop()
      // Minutes of work that must not slow to a crawl when the reader switches
      // to another window (main.ts, 'background-work'); undone in `finally`.
      await api.setBackgroundWork?.(true)
      setVideoProgress({ phase: 'preparing', slide: 0, slides: 0, sentence: 0, sentences: 0 })
      const [{ officeJobToPdf }, { pptxText }, { buildSlideVideo }] = await Promise.all([
        import('./services/officePdf'),
        import('./services/ooxmlText'),
        import('./services/slideVideo'),
      ])
      // The slides as "Save as PDF" prints them — hidden ones are already out,
      // so the notes are taken from the slides shown, in the same order.
      const pdf = await officeJobToPdf(await view.pdfJob())
      const notes = (await pptxText(office.bytes)).filter(s => !s.hidden).map(s => s.notes)
      const korean = notes.some(n => /[가-힣]/.test(n))
      const video = await buildSlideVideo({
        pdf,
        notes,
        synthesize: tts.synthesizeBatch,
        language: korean ? 'kor' : 'eng',
        captionName: t(korean ? 'video.trackKorean' : 'video.trackEnglish'),
        signal: controller.signal,
        onProgress: p => setVideoProgress({ phase: 'making', ...p }),
      })
      setVideoProgress(p => (p ? { ...p, phase: 'saving' } : p))
      const name = await api.writeVideoFile(target.token, video.mp4)
      showToast(t('video.saved', { name }))
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') showToast(t('video.cancelled'))
      else {
        console.error('Slide video failed:', err)
        showToast(t('video.failed', { error: errorMessage(err) }))
      }
    } finally {
      videoAbort.current = null
      setVideoProgress(null)
      void api.setBackgroundWork?.(false).catch(() => undefined)
    }
  }, [office, file, tts, showToast, reportSpeechFailure])

  const handleSaveOfficePdf = useCallback(async (): Promise<boolean> => {
    const view = officeHandleRef.current
    if (!view || officeSaveBusy.current) return false
    officeSaveBusy.current = true
    try {
      return await saveOfficePdf(view)
    } finally {
      officeSaveBusy.current = false
    }
  }, [saveOfficePdf])

  const handleOfficeFitWidth = useCallback(() => {
    const z = officeHandleRef.current?.fitWidth()
    if (z) setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +z.toFixed(2))))
  }, [])

  // Memoised. This object used to be rebuilt on every App render, which rebuilt
  // every page's highlight arrays and re-ran the text layer's scroll-to-match —
  // including on the render each scroll step causes through setCurrentPage.
  const viewerSearch = useMemo(
    () => (showSearch ? { matches: search.matches, activeIndex: search.activeIndex } : undefined),
    [showSearch, search.matches, search.activeIndex],
  )

  // ── Global keyboard shortcuts ─────────────────────────────────────────────
  // Declared here, not with the other hooks above, because it needs the
  // read-aloud toggle — and hoisting that instead would put the whole speech
  // wiring above the state it reads.
  // Undo / redo, from the keyboard or the editing toolbar. Page documents only:
  // a Markdown edit happens in a textarea, which has its own undo.
  const canEditHistory = !!pdfDoc && !flowDoc
  const handleUndo = useCallback(() => {
    if (history.undo()) showToast(t('history.undone'))
  }, [history, showToast])
  const handleRedo = useCallback(() => {
    if (history.redo()) showToast(t('history.redone'))
  }, [history, showToast])

  // Closing the window (or reloading) with unsaved changes. In a browser this
  // raises its own "leave site?" prompt; in the desktop app the main process
  // turns it into a dialog (see will-prevent-unload in electron/main.ts).
  useEffect(() => {
    if (!unsaved) return
    const hold = (e: BeforeUnloadEvent) => {
      if (leavingRef.current) return
      e.preventDefault(); e.returnValue = ''
    }
    window.addEventListener('beforeunload', hold)
    return () => window.removeEventListener('beforeunload', hold)
  }, [unsaved])

  // Ctrl+S: the document's own save — PDF for pages, the source for Markdown
  // (only while editing it; the reading view has nothing to save).
  const handleSaveShortcut = useMemo(() => {
    // An embedded or private viewer saves nothing (Office documents used to
    // slip through here in embed mode, with the save button hidden).
    if (chromeless) return undefined
    if (markdown !== null) {
      return appMode === 'editor' ? () => { void markdownSaveRef.current?.() } : undefined
    }
    if (office !== null) return () => { void handleSaveOfficePdf() }
    return pdfDoc ? () => { void handleExportPdf() } : undefined
  }, [markdown, office, appMode, pdfDoc, chromeless, handleExportPdf, handleSaveOfficePdf])

  // ── Copy / paste a stamp ──────────────────────────────────────────────────
  // For putting the same stamp in the same place on every page: copy it on
  // page 1, paste on page 2, and it lands at the same coordinates, size and
  // angle. The page pasted onto is the one under the pointer (the page counter
  // is only tracked in single view), else the page in view. Pasted back onto
  // its own page it is nudged, or the copy would sit exactly on the original.
  // The clipboard outlives the document, so a stamp can be carried to another
  // file too.
  const annotationClipboard = useRef<{ annotation: OmitId<Annotation>; pastesByPage: Map<number, number>; sourceDoc: unknown } | null>(null)

  // Pages picked in the left page list, and when. Ctrl+V pastes onto them —
  // several at once if several are picked — as long as that pick is the latest
  // thing the reader did; clicking in or scrolling the document afterwards
  // means "here" again. The list's selection does not follow scrolling, so
  // without the "latest" rule a pick made long ago would silently win.
  const panelPick = useRef<{ pages: number[]; at: number } | null>(null)
  const documentTouchedAt = useRef(0)
  useEffect(() => { panelPick.current = null }, [pdfDoc])
  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    const touched = () => { documentTouchedAt.current = performance.now() }
    const SCROLL_KEYS = new Set(['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '])
    const key = (e: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(e.key)) return
      const t = e.target as Element | null
      if (t?.closest('nav, input, textarea, [contenteditable="true"]')) return
      touched()
    }
    main.addEventListener('pointerdown', touched, { passive: true })
    main.addEventListener('wheel', touched, { passive: true })
    window.addEventListener('keydown', key, true)
    return () => {
      main.removeEventListener('pointerdown', touched)
      main.removeEventListener('wheel', touched)
      window.removeEventListener('keydown', key, true)
    }
  }, [])
  const handlePanelSelection = useCallback((pages: number[]) => {
    panelPick.current = pages.length > 0 ? { pages, at: performance.now() } : null
  }, [])
  // Where the pointer is, not which page it was last over: scrolling with the
  // wheel or the keyboard moves the pages under a still pointer and fires no
  // pointer event, so remembering "the page under the last move" pasted every
  // copy after the first onto the page before. The page is looked up at paste
  // time, from the pointer's position, against the pages as they are now.
  const pointerAt = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const track = (e: PointerEvent) => { pointerAt.current = { x: e.clientX, y: e.clientY } }
    window.addEventListener('pointermove', track, { passive: true })
    return () => window.removeEventListener('pointermove', track)
  }, [])
  const pageUnderPointer = useCallback((): number | null => {
    const at = pointerAt.current
    if (!at) return null
    const el = document.elementFromPoint(at.x, at.y)?.closest(`[${PAGE_ATTR}]`)
    const n = el ? Number(el.getAttribute(PAGE_ATTR)) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  }, [])
  /** The page with the most of itself on screen — when the pointer is not on one. */
  const pageMostInView = useCallback((): number | null => {
    const view = mainRef.current?.getBoundingClientRect()
    if (!view) return null
    let best: number | null = null
    let bestArea = 0
    for (const el of document.querySelectorAll(`[${PAGE_ATTR}]`)) {
      const r = el.getBoundingClientRect()
      const w = Math.min(r.right, view.right) - Math.max(r.left, view.left)
      const h = Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top)
      if (w > 0 && h > 0 && w * h > bestArea) { bestArea = w * h; best = Number(el.getAttribute(PAGE_ATTR)) }
    }
    return best
  }, [])

  const copySelectedAnnotation = useCallback((): OmitId<Annotation> | null => {
    if (appMode !== 'editor' || !selectedId) return null
    // Text selected in the document means the reader is copying text.
    if (window.getSelection()?.toString()) return null
    const a = annotations.find(x => x.id === selectedId)
    if (!a || !COPYABLE_ANNOTATIONS.has(a.type)) return null
    const { id: _id, ...rest } = a
    void _id
    annotationClipboard.current = { annotation: rest as OmitId<Annotation>, pastesByPage: new Map(), sourceDoc: pdfDoc }
    return rest as OmitId<Annotation>
  }, [appMode, selectedId, annotations, pdfDoc])

  const handleCopyAnnotation = useCallback((): boolean => {
    if (!copySelectedAnnotation()) return false
    showToast(t('annotation.copied'))
    return true
  }, [copySelectedAnnotation, showToast])

  const handleCutAnnotation = useCallback((): boolean => {
    if (!copySelectedAnnotation() || !selectedId) return false
    removeAnnotation(selectedId)
    showToast(t('annotation.cut'))
    return true
  }, [copySelectedAnnotation, selectedId, removeAnnotation, showToast])

  const handlePasteAnnotation = useCallback((): boolean => {
    const clip = annotationClipboard.current
    if (!clip || appMode !== 'editor' || !pdfDoc || numPages < 1) return false
    const source = clip.annotation
    const pick = panelPick.current
    const fromList = isPanelOpen && pick !== null && pick.at > documentTouchedAt.current
    let pages = fromList
      ? pick.pages.filter(p => p >= 1 && p <= numPages)
      : [Math.min(Math.max(1, pageUnderPointer() ?? pageMostInView() ?? currentPage), numPages)]
    // Several pages at once: the page it was copied from already has it.
    if (pages.length > 1 && clip.sourceDoc === pdfDoc) {
      const others = pages.filter(p => p !== source.page)
      if (others.length > 0) pages = others
    }
    if (pages.length === 0) return false
    // One undo step for the whole paste, however many pages it covered.
    recordEdit()
    for (const page of pages) {
      // Same place on another page; nudged on its own page so it is visible.
      const count = clip.pastesByPage.get(page) ?? (page === source.page && clip.sourceDoc === pdfDoc ? 1 : 0)
      clip.pastesByPage.set(page, count + 1)
      const offset = count * PASTE_NUDGE
      addAnnotationRaw({ ...source, page, x: source.x + offset, y: source.y + offset } as OmitId<Annotation>)
    }
    if (pages.length > 1) showToast(t('annotation.pastedPages', { n: pages.length }))
    return true
  }, [appMode, pdfDoc, numPages, currentPage, isPanelOpen, recordEdit, addAnnotationRaw, showToast, pageUnderPointer, pageMostInView])

  useGlobalShortcuts({
    pdfDoc, flowDoc, viewMode, appMode, activeMode, annotations, selectedId,
    // Alt+F5 starts where the reader is — for Word and PowerPoint that is the
    // view's own page, not the PDF counter (which stayed at 1 for them).
    currentPage: pagedOffice ? officePages!.current : currentPage,
    setViewMode, setShowSearch, onEnterFullscreen: enterFullscreen, fileInputRef,
    removeAnnotation, clearMarkups, setActiveMode, selectAnnotation,
    onRunOcr: () => ocr.runPage(currentPage),
    onRunOcrAll: ocr.runAll,
    onToggleSpeech: window.electronAPI?.ttsSynthesize ? handleToggleSpeech : undefined,
    // Bound only while something is being read, so Alt+arrow keeps whatever it
    // otherwise means the rest of the time.
    onSpeechPrevious: tts.status === 'idle' ? undefined : tts.previous,
    onSpeechNext: tts.status === 'idle' ? undefined : tts.next,
    onSpeechPlayPause: tts.status === 'idle' ? undefined
      : () => { void (tts.status === 'paused' ? tts.resume() : tts.pause()) },
    onUndo: canEditHistory ? handleUndo : undefined,
    onRedo: canEditHistory ? handleRedo : undefined,
    onSave: handleSaveShortcut,
    canPrint,
    readOnly: locked,
    onCopyAnnotation: handleCopyAnnotation,
    onCutAnnotation: handleCutAnnotation,
    onPasteAnnotation: handlePasteAnnotation,
  })

  const officeViewProps = {
    zoom,
    fullscreen: viewMode === 'fullscreen',
    onExitFullscreen: handleFullscreenExit,
    viewMode,
    onViewModeChange: handleViewModeChange,
    panelOpen: isPanelOpen,
    handleRef: officeHandleRef,
    onPageInfo: setOfficePages,
    showNotes: showSlideNotes,
    fullscreenStartPage,
    speaking: tts.status !== 'idle' ? tts.currentText : null,
  }

  const actionBarProps = {
    hasPdf: !!pdfDoc,
    flowDoc,
    // Pages take stamps and page edits, Markdown its source. Word, sheets and
    // mail have nothing to edit.
    canEdit: !!pdfDoc || markdown !== null,
    embed: chromeless,
    appMode,
    viewMode,
    zoom,
    rotation,
    activeMode,
    selectedId,
    isExporting: isExporting || savingOfficePdf || videoProgress !== null,
    // A Word or PowerPoint document reports its own pages for the counter.
    numPages: pagedOffice ? officePages!.count : numPages,
    currentPage: pagedOffice ? officePages!.current : currentPage,
    pagedFlow: pagedOffice,
    slideNotes: officePages?.hasNotes
      ? { on: showSlideNotes, onToggle: () => setShowSlideNotes(v => !v) }
      : undefined,
    onSaveOfficePdf: office !== null && !chromeless ? () => { void handleSaveOfficePdf() } : undefined,
    onSaveSlideVideo: canMakeVideo ? () => { void handleSaveSlideVideo() } : undefined,
    isPanelOpen,
    onTogglePanel: () => setIsPanelOpen(v => !v),
    onUpload: handleUpload,
    onOpenUrl: () => setShowUrlModal(true),
    onExportPdf: handleExportPdf,
    onPassword: handlePassword,
    saveLocked: !!savePassword,
    // Booklet layout of the two-page view; page documents only (the menu is
    // not shown for Markdown or mail at all).
    onExportSpreads: pdfDoc ? handleExportSpreads : undefined,
    onExportHtml: handleExportHtml,
    onExportImages: handleExportImages,
    // EXE Viewer:
    //   - Electron: appends PDF bytes onto the running portable exe.
    //   - Web:      redirects to the installer download (see useExporters).
    onExportExe: handleExportExe,
    // Undefined on the web build, where there is no speech engine — which is
    // also what hides the button.
    onToggleSpeech: window.electronAPI?.ttsSynthesize ? handleToggleSpeech : undefined,
    isSpeaking: tts.status !== 'idle',
    fileName: file?.name,
    unsaved,
    onUndo: canEditHistory ? handleUndo : undefined,
    onRedo: canEditHistory ? handleRedo : undefined,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    onPrint: canPrint ? handlePrintAny : undefined,
    onAppModeChange: handleAppModeChange,
    onViewModeChange: handleViewModeChange,
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onZoomReset: handleZoomReset,
    onZoomSet: handleZoomSet,
    onFitWidth: office !== null ? handleOfficeFitWidth : fitWidth,
    onRotate: handleRotate,
    onRotateLeft: handleRotateLeft,
    onModeChange: setActiveMode,
    onStampSelect: (src: string, presetId?: string) => { void handleStampSelect(src, presetId) },
    savedStamps: stampLibrary.stamps,
    onSavedStampSelect: handleSavedStampSelect,
    onSavedStampRemove: (id: string) => { void removeSavedStamp(id) },
    onStampUpload: (f: File) => { void handleStampUpload(f) },
    onSignatureClick: handleSignatureClick,
    onWatermarkClick: handleWatermarkClick,
    onDeleteSelected: handleDeleteSelected,
    onResetMarkups: handleResetMarkups,
    hasMarkups: annotations.some(isVolatile),
    onRunOcr: () => ocr.runPage(currentPage),
    onRunOcrAll: ocr.runAll,
    onCancelOcr: ocr.cancel,
    isOcrRunning: ocr.isOcrRunning,
    ocrProgress: ocr.ocrProgress,
  }

  const panelVisible = isPanelOpen && !!pdfDoc && viewMode !== 'fullscreen'

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-gray-900">
      {/* Before the toolbar, purely for the keyboard: the bar is `fixed`, so
          where it sits in the markup does not move it on screen, but it is what
          decides where Tab reaches it. At the end of the tree its first control
          was the 21st stop, behind every toolbar button — and it only exists
          while something is being read, which is exactly when it is the control
          most likely to be wanted. */}
      <TtsBar
        status={tts.status}
        index={tts.index}
        chunkCount={tts.chunkCount}
        error={tts.error}
        model={tts.model}
        downloading={tts.downloading}
        downloadProgress={tts.downloadProgress}
        promptOpen={ttsPromptOpen}
        voice={tts.draftVoice}
        speed={tts.draftSpeed}
        canApply={tts.canApply}
        applying={tts.applying}
        onDownload={handleTtsDownload}
        onCancelDownload={tts.cancelDownload}
        onDismissPrompt={() => setTtsPromptOpen(false)}
        onPrevious={tts.previous}
        onNext={tts.next}
        onPause={tts.pause}
        onResume={tts.resume}
        onStop={tts.stop}
        onVoiceChange={tts.setVoice}
        onSpeedChange={tts.setSpeed}
        onApply={tts.applySettings}
      />

      <ActionBar {...actionBarProps} />

      {askEncryptPassword && (
        <PasswordSetPrompt
          onSubmit={password => {
            setAskEncryptPassword(false)
            setChosenPassword({ from: documentPassword, value: password })
            showToast(t('password.willApply'))
          }}
          onCancel={() => setAskEncryptPassword(false)}
        />
      )}

      {pendingLeave && file && (
        <UnsavedChangesDialog
          fileName={file.name}
          reason={pendingLeave.reason}
          onSave={async () => {
            const saved = flowDoc && markdown !== null
              ? await (markdownSaveRef.current?.() ?? Promise.resolve(false))
              : await handleExportPdf()
            if (saved) { setPendingLeave(null); pendingLeave.proceed() }
            return saved
          }}
          onDiscard={() => { setPendingLeave(null); pendingLeave.proceed() }}
          onCancel={() => setPendingLeave(null)}
        />
      )}
      {passwordPrompt && (
        <PasswordPrompt
          wrong={passwordPrompt.wrong}
          onSubmit={submitPassword}
          onCancel={cancelPassword}
        />
      )}

      {/* The highlight is for people who can see it; this is the same
          information for people who cannot. Mounted always, because the thing
          most worth announcing — that reading has ended — happens at the moment
          the bar itself disappears. */}


      <SpeechAnnouncer status={tts.status} />

      <SpeechHighlight text={tts.currentText} index={tts.index} />



      {/* Hidden file input for F2 / double-click to open — absent while
          private mode is (or may be) on, so F2 has nothing to open. */}
      {!locked && <input
        ref={fileInputRef}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) handleUpload(f)
          e.target.value = ''
        }}
      />}

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
              readOnly={appMode === 'viewer' || !pagesEditable}
              readOnlyNote={appMode === 'editor' && !pagesEditable ? t('panel.pdfOnly') : undefined}
              onError={showToast}
              onClose={() => setIsPanelOpen(false)}
              // Only for PDFs: extraction is pdf-lib's job, and it has nothing
              // to say about a HWP page or an image.
              onSavePages={kind === 'pdf' && !chromeless ? handleSavePages : undefined}
              onSelectionChange={handlePanelSelection}
              onScrollToPage={page => {
                setScrollToPage(page)
                if (viewMode === 'grid') setViewMode('single')
                // On mobile, navigating to a page should close the drawer so
                // the user can see the page they just chose.
                if (window.matchMedia('(max-width: 767px)').matches) {
                  setIsPanelOpen(false)
                }
              }}
              onDeletePages={async pages => {
                if (await handleDeletePages(pages)) showToast(t('panel.deleted', { n: pages.length }))
              }}
              onInsertBlankPage={handleInsertBlankPage}
              onInsertFromPdf={handleInsertFromPdf}
              onReorderPages={handleReorderPages}
            />
          </div>
        )}
        <main
          ref={mainRef}
          aria-label={t('a11y.document')}
          className="flex-1 overflow-hidden"
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) handleUpload(f)
          }}
          onDoubleClick={handleMainDoubleClick}
          // No "Save image as…" on a page in a private viewer.
          onContextMenu={locked ? e => e.preventDefault() : undefined}
        >
          {/* The document's own heading. There was none anywhere in the viewing
              path, so a screen reader had nothing to navigate by and no name for
              what it had just opened — the file name is only painted in the
              toolbar. Hidden, because the toolbar already shows it. */}
          {file && numPages > 0 && (
            <h1 className="sr-only">
              {t('a11y.documentNamed', { name: file.name, n: numPages })}
            </h1>
          )}
          {error && (
            <div className="flex items-center justify-center h-full text-red-400 p-4">
              {t('error.loadFailed', { error })}
            </div>
          )}
          {isLoading && (
            <div className="flex items-center justify-center h-full text-gray-400">
              {t('doc.loading')}
            </div>
          )}
          {/* Drag/Open prompt — hidden in embed mode (can't drop into an iframe;
              the PDF auto-loads from ?url). */}
          {nothingOpen && openingAtLaunch && (
            <div className="flex items-center justify-center h-full text-gray-400">
              {t('doc.loading')}
            </div>
          )}
          {nothingOpen && !openingAtLaunch && (
            <StartScreen onOpenFile={() => fileInputRef.current?.click()} onOpenRecent={openPath} update={update} />
          )}
          {/* Embed and private placeholder: why nothing could be shown, or a
              spinner while it loads. `!file`, not `!pdfDoc`: Word, slides,
              Markdown and mail have no pdfDoc, and the spinner stayed on top
              of them in embed mode. */}
          {chromeless && !file && !isLoading && !error && (
            (locked ? privateMessage : urlError) ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-300 select-none">
                {locked ? privateMessage : urlError}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center gap-2 text-gray-400 text-sm select-none">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
                {t('url.loading')}
              </div>
            )
          )}
          {markdown !== null && (
            <ErrorBoundary>
              <Suspense fallback={null}>
                <MarkdownView
                  source={markdown}
                  filename={file?.name ?? 'document.md'}
                  appMode={appMode}
                  zoom={zoom}
                  fullscreen={viewMode === 'fullscreen'}
                  onExitFullscreen={handleFullscreenExit}
                  onSaved={showToast}
                  onError={showToast}
                  onDirtyChange={setMarkdownDirty}
                  saveRef={markdownSaveRef}
                />
              </Suspense>
            </ErrorBoundary>
          )}
          {office && (
            <ErrorBoundary>
              <Suspense fallback={null}>
                {office.kind === 'docx' ? (
                  <DocxView
                    bytes={office.bytes}
                    {...officeViewProps}
                  />
                ) : office.kind === 'pptx' ? (
                  <PptxView
                    bytes={office.bytes}
                    {...officeViewProps}
                  />
                ) : (
                  <SheetView
                    bytes={office.bytes}
                    name={office.name}
                    {...officeViewProps}
                  />
                )}
              </Suspense>
            </ErrorBoundary>
          )}
          {email && (
            <ErrorBoundary>
              <Suspense fallback={null}>
                <EmailView
                  email={email}
                  onOpenAttachment={locked ? undefined : handleUpload}
                  canDownload={!locked}
                  zoom={zoom}
                  fullscreen={viewMode === 'fullscreen'}
                  onExitFullscreen={handleFullscreenExit}
                />
              </Suspense>
            </ErrorBoundary>
          )}
          {pdfDoc && (
            <ErrorBoundary>
              <Suspense fallback={
                <div className="flex h-full items-center justify-center gap-2 text-gray-400 text-sm select-none">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
                  {t('url.loading')}
                </div>
              }>
              <PdfViewer
                pdfDoc={pdfDoc}
                numPages={numPages}
                zoom={zoom}
                rotation={rotation}
                appMode={appMode}
                kind={kind}
                annotations={annotations}
                selectedId={selectedId}
                activeMode={activeMode}
                viewMode={viewMode}
                fullscreenLayout={fullscreenLayout}
                fullscreenStartPage={fullscreenStartPage}
                fullscreenFollowPage={presentFollowPage}
                pendingStamp={pendingStamp}
                pendingSignature={pendingSignature}
                onAnnotationSelect={selectAnnotation}
                onAnnotationUpdate={updateAnnotation}
                onAnnotationAdd={handleAnnotationAdd}
                onGridPageClick={handleGridPageClick}
                onFullscreenExit={handleFullscreenExit}
                onCurrentPageChange={setCurrentPage}
                search={viewerSearch}
                ocrResults={ocr.ocrResults}
                ocrActivePage={ocr.ocrActivePage}
                onOcrRequest={ocr.runPage}
                onRegionCopy={handleRegionCopy}
              />
              </Suspense>
            </ErrorBoundary>
          )}
        </main>
      </div>

      {/* Find bar (Ctrl+F) */}
      {showSearch && (pdfDoc || flowDoc) && (
        <SearchBar
          total={findBar.total}
          activeIndex={findBar.activeIndex}
          isSearching={findBar.isSearching}
          onChange={findBar.run}
          onNext={findBar.next}
          onPrev={findBar.prev}
          onClose={() => { setShowSearch(false); findBar.clear() }}
        />
      )}

      {/* Lazy-loaded modals — Suspense fallback is `null` because the user
          clicked a button, so a tiny load delay is acceptable. */}
      <ErrorBoundary resetKey={file}>
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
        {previewPages && (
          <PrintPreviewModal
            pages={previewPages}
            onConfirm={confirmPrint}
            onCancel={cancelPrint}
          />
        )}
      </Suspense>
      </ErrorBoundary>
      {videoProgress && (
        <VideoExportPanel progress={videoProgress} onCancel={() => videoAbort.current?.abort()} />
      )}
      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          onDismiss={() => setToast(null)}
        />
      )}

      {update.state?.ready && (
        <UpdateToast version={update.state.ready} onInstall={restartToUpdate} />
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
