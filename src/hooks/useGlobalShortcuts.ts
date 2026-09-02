import { useEffect, useRef, type RefObject } from 'react'
import { LANG } from '../i18n'
import type { ViewMode, AppMode } from '../types/viewModes'
import type { ViewerDoc } from '../types/viewerDoc'
import type { Annotation, ActiveMode } from '../types/annotation'

interface GlobalShortcutsDeps {
  pdfDoc: ViewerDoc | null
  /** A reflowing document (Markdown / mail) is open — it has no ViewerDoc but
   *  can still be presented fullscreen. */
  flowDoc: boolean
  viewMode: ViewMode
  appMode: AppMode
  activeMode: ActiveMode
  annotations: Annotation[]
  selectedId: string | null
  setViewMode: (mode: ViewMode) => void
  setShowSearch: (show: boolean) => void
  setFullscreenLayout: (layout: 'single' | 'spread') => void
  prevViewModeRef: RefObject<ViewMode>
  fileInputRef: RefObject<HTMLInputElement | null>
  removeAnnotation: (id: string) => void
  clearMarkups: () => void
  setActiveMode: (mode: ActiveMode) => void
  /** OCR the page in view. */
  onRunOcr: () => void
  /** OCR every page. */
  onRunOcrAll: () => void
  /** Start or stop reading aloud. Absent outside the desktop build. */
  onToggleSpeech?: () => void
  /** Moving through what is being read. Absent when nothing is being read. */
  onSpeechPrevious?: () => void
  onSpeechNext?: () => void
  onSpeechPlayPause?: () => void
}

/**
 * How long a second `r` still counts as a double press.
 *
 * The single-press action is deliberately delayed by this much, rather than run
 * immediately and then corrected: OCR takes seconds, so a third of one is
 * imperceptible, whereas running the current page and *then* the whole document
 * would recognize the visible page twice.
 */
const DOUBLE_PRESS_MS = 350

/**
 * Global keyboard shortcuts. A single capture-phase listener covers every
 * shortcut so we don't have to reason about ordering between multiple
 * `window.addEventListener` calls — and, crucially, so `stopImmediatePropagation`
 * on the ESC two-step actually blocks FullscreenView's own window listener.
 *
 * Shortcuts: F1 help, Ctrl+P print, Ctrl+F find, F2 open, F5 fullscreen,
 * Delete/Backspace remove selection, ESC (two-step: clear markups → exit
 * fullscreen), 1 pen, 2 rectangle, R OCR this page (RR the whole document),
 * S read aloud, and while reading Alt+← / Alt+→ / Alt+Space to move through it.
 */
export function useGlobalShortcuts({
  pdfDoc, flowDoc, viewMode, appMode, activeMode, annotations, selectedId,
  setViewMode, setShowSearch, setFullscreenLayout,
  prevViewModeRef, fileInputRef,
  removeAnnotation, clearMarkups, setActiveMode,
  onRunOcr, onRunOcrAll, onToggleSpeech,
  onSpeechPrevious, onSpeechNext, onSpeechPlayPause,
}: GlobalShortcutsDeps) {
  // Set while waiting to see whether an `r` becomes `rr`.
  const ocrTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (ocrTimer.current) clearTimeout(ocrTimer.current) }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null
      const inInput = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)

      // ── App-level shortcuts (work regardless of pdf state) ─────────────────
      if (e.key === 'F1') {
        // Help: open in user's default browser (Electron via IPC + shell;
        // web fallback opens a new tab pointing at the same static asset).
        // Korean locale → help.html, everything else → help.en.html.
        e.preventDefault()
        const helpFile = LANG === 'ko' ? 'help.html' : 'help.en.html'
        if (window.electronAPI?.openHelp) {
          window.electronAPI.openHelp(LANG)
        } else {
          window.open(`./${helpFile}`, '_blank', 'noopener,noreferrer')
        }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('wz-print'))
        return
      }
      // Ctrl/Cmd+F → open the find bar (replaces the browser's native find).
      // Highlighting is single-view only, so switch out of grid/spread.
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && (pdfDoc || flowDoc) && viewMode !== 'fullscreen') {
        e.preventDefault()
        if (viewMode === 'grid' || viewMode === 'spread') setViewMode('single')
        setShowSearch(true)
        return
      }
      if (e.key === 'F2' && viewMode !== 'fullscreen') {
        e.preventDefault()
        fileInputRef.current?.click()
        return
      }
      if (e.key === 'F5' && (pdfDoc || flowDoc) && viewMode !== 'fullscreen') {
        // Inline the fullscreen-entry logic (it's also in handleViewModeChange
        // but that's declared further down — avoid the temporal-dead-zone issue).
        e.preventDefault()
        prevViewModeRef.current = viewMode
        setFullscreenLayout(viewMode === 'spread' ? 'spread' : 'single')
        setViewMode('fullscreen')
        return
      }
      // ── Moving through what is being read ────────────────────────────────
      // Deliberately modifier combinations rather than bare letters. A screen
      // reader in browse mode swallows single letters as its own quick-nav keys
      // (in NVDA `s` is "next separator", `r` "next radio button"), so a plain
      // letter would never reach the app for the readers these controls exist
      // for. Alt+arrow is free in every mode.
      //
      // Only bound while something is being read, so Alt+Left keeps whatever it
      // otherwise means the rest of the time.
      if (e.altKey && !e.ctrlKey && !e.metaKey && !inInput) {
        if (e.key === 'ArrowLeft' && onSpeechPrevious) {
          e.preventDefault(); onSpeechPrevious(); return
        }
        if (e.key === 'ArrowRight' && onSpeechNext) {
          e.preventDefault(); onSpeechNext(); return
        }
        if (e.key === ' ' && onSpeechPlayPause) {
          e.preventDefault(); onSpeechPlayPause(); return
        }
      }

      // Letter shortcuts are case-insensitive. They fire bare **or with Alt**,
      // for the reason given above: a screen reader in browse mode keeps the
      // bare letter for its own quick-nav, so `S` alone never reaches the app
      // for the readers read-aloud exists for. Alt+S and Alt+R do the same
      // thing and pass straight through. Ctrl and Cmd stay excluded, so Ctrl+R
      // (reload) and Ctrl+S (save) keep their usual meaning.
      //
      // They are here, above the PDF-only guard below, because reading aloud
      // works for Markdown and mail as well.
      const letter = e.key.length === 1 ? e.key.toLowerCase() : ''
      const plain = !e.ctrlKey && !e.metaKey && !inInput

      if (letter === 's' && plain && onToggleSpeech && (pdfDoc || flowDoc)) {
        e.preventDefault()
        onToggleSpeech()
        return
      }

      // OCR is page-only, and pointless while presenting.
      if (letter === 'r' && plain && pdfDoc && viewMode !== 'fullscreen') {
        e.preventDefault()
        if (ocrTimer.current) {
          // Second press within the window: the whole document, and the pending
          // single-page run is dropped so the visible page is not done twice.
          clearTimeout(ocrTimer.current)
          ocrTimer.current = null
          onRunOcrAll()
        } else {
          ocrTimer.current = setTimeout(() => { ocrTimer.current = null; onRunOcr() }, DOUBLE_PRESS_MS)
        }
        return
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && appMode === 'editor') {
        removeAnnotation(selectedId)
        return
      }

      // ── Markup shortcuts — require a PDF and not typing in an input ────────
      if (!pdfDoc || inInput) return

      // In fullscreen, FullscreenView owns the (ZoomIt-style) presenter keymap,
      // so skip the normal-view markup shortcuts (Esc two-step, 1=pen, 2=rect).
      const inPresentation = viewMode === 'fullscreen'

      // ESC two-step priority:
      //   1st press — drawing mode active OR pen/rectangle markups exist:
      //               exit drawing mode + clear all markups (fullscreen stays).
      //   2nd press — nothing to clear, falls through to FullscreenView which
      //               exits fullscreen.
      // Keyboard Lock API (in FullscreenView) keeps the browser from
      // auto-exiting fullscreen on ESC, giving this handler first crack.
      if (e.key === 'Escape' && !inPresentation) {
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
      if (e.key === '1' && !inPresentation) {
        setActiveMode(activeMode === 'pen' ? null : 'pen')
        return
      }
      if (e.key === '2' && !inPresentation) {
        setActiveMode(activeMode === 'rectangle' ? null : 'rectangle')
        return
      }
    }
    // Capture phase ensures App's handler runs BEFORE FullscreenView's window
    // listener, so stopImmediatePropagation() above actually blocks it.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
    // Setters/refs are stable; re-run only on the reactive values the handler
    // reads. Exact dep list preserved from the original inline effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, removeAnnotation, appMode, viewMode, pdfDoc, flowDoc, activeMode, annotations, clearMarkups, setActiveMode, onRunOcr, onRunOcrAll, onToggleSpeech])
}
