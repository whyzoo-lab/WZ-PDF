import React, { useEffect, useState, type ReactNode } from 'react'
import type { AppMode, ViewMode } from '../../types/viewModes'
import type { ActiveMode } from '../../types/annotation'
import { STAMP_PRESETS, svgToPng } from '../../utils/stampPresets'
import type { SavedStamp } from '../../services/stampLibrary'
import { classifyDocFile, DOCUMENT_ACCEPT } from '../../utils/detectDocType'
import { t, tEnglish, type MessageKey } from '../../i18n'
import {
  IconSingle, IconSpread, IconGrid, IconFullscreen, IconRotate, IconSelect, IconUndo, IconRedo, IconFolderOpen, IconSave,
  IconStamp, IconSignature, IconWatermark, IconDelete, IconLink,
  IconHtml, IconImage, IconPrint, IconOcr, IconReset,
  IconExe, IconLock, IconLockOpen, IconPencil, IconFitWidth,
  IconSpeak, IconStopSpeak, IconRotateLeft, IconVideo, IconFile, IconSearch, IconPages, IconNotes, IconCommand,
  IconZoomIn, IconZoomOut, IconAppearance,
  IconHighlight, IconUnderline, IconStrike, IconNote, IconFill, IconCompare, IconRedact, IconCertificate, IconCompress,
} from './icons'
import { OcrAnnouncer } from '../OcrAnnouncer'
import { ZoomControl } from './ZoomControl'
import { TitleBar, type TitleTab } from './TitleBar'
import { ToolRail } from './ToolRail'
import { MENU_ROW, MenuDivider, type RailAxis, type RailItem } from './rail'
import type { FillTool } from '../fill/fillContext'

const FILL_TOOLS: FillTool[] = ['text', 'check', 'cross', 'dot', 'line', 'date']
const FILL_GLYPH: Record<FillTool, string> = { text: 'Ab', check: '✓', cross: '✕', dot: '●', line: '─', date: '📅' }
import { CommandPalette, type PaletteCommand } from './CommandPalette'
import { openHelp } from '../../utils/openHelp'
import type { Appearance } from '../../hooks/useAppearance'

export interface ActionBarProps {
  /** A page-based document is open (PDF / HWP / image) — the ViewerDoc pipeline. */
  hasPdf: boolean
  /** A reflowing document is open (Markdown / mail). It has no pages, so only
   *  the controls that mean something without page geometry are shown. */
  flowDoc: boolean
  /**
   * Whether the open document has anything the edit switch could change. False
   * for Word, spreadsheets and mail, which are read-only views — a switch
   * that turns on and does nothing reads as broken. Defaults to true.
   */
  canEdit?: boolean
  /**
   * A Word or PowerPoint document is open: reflowing HTML, but with pages, so
   * the page controls a PDF has — layouts, page counter, page list — apply.
   */
  pagedFlow?: boolean
  /** A deck with speaker notes: whether they show under each slide, and the switch. */
  slideNotes?: { on: boolean; onToggle: () => void }
  /** A deck with speaker notes, in the desktop app: record it as a narrated video. */
  onSaveSlideVideo?: () => void
  /** Embed mode (?embed) or a private viewer: no open, save, edit or password. */
  embed?: boolean
  appMode: AppMode
  viewMode: ViewMode
  zoom: number
  rotation: number
  activeMode: ActiveMode
  selectedId: string | null
  isPanelOpen: boolean
  onTogglePanel: () => void
  /** True while any export is in progress — disables all export items. */
  isExporting: boolean
  numPages: number
  currentPage: number
  onUpload: (file: File) => void
  /** Several files at once (two or more pictures become one collection). */
  onUploadMany?: (files: File[]) => void
  /** Open the "load from URL" modal. */
  onOpenUrl: () => void
  /** Absent where printing is not allowed (a private viewer): no print button. */
  onPrint?: () => void
  /** Open the find bar (the same as Ctrl+F). */
  onFind?: () => void
  /** Compare the open document's text with another file (page documents). */
  onCompare?: () => void
  /** Open documents as tabs (two or more show in the title bar). */
  tabs?: TitleTab[]
  onTab?: (id: string) => void
  onCloseTab?: (id: string) => void
  /** Reduce the PDF's file size (save menu). */
  onOptimize?: () => void
  /** Beside the title: the signatures' state (SignatureBadge). */
  signatureBadge?: ReactNode
  /** Sign the document with a certificate file. */
  onSign?: () => void
  /** Redaction (PDF): arm a tool, find and mark, apply what is marked. */
  redact?: { pending: number; onArm: (mode: 'redact' | 'redactArea') => void; onFind: () => void; onApply: () => void; onClear: () => void }
  onAppModeChange: (mode: AppMode) => void
  onViewModeChange: (mode: ViewMode) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  /** Set an exact zoom (fraction, e.g. 1.25) — from the editable zoom field. */
  onZoomSet: (zoom: number) => void
  /** Zoom so the page fills the width, the way a browser PDF viewer opens one. */
  onFitWidth: () => void
  onRotate: () => void
  /** Counter-clockwise. */
  onRotateLeft: () => void
  onModeChange: (mode: ActiveMode) => void
  onStampSelect: (src: string, presetId?: string) => void
  /** "내 도장": stamps the reader uploaded, kept on this computer. */
  savedStamps?: SavedStamp[]
  onSavedStampSelect?: (stamp: SavedStamp) => void
  onSavedStampRemove?: (id: string) => void
  /** Handles an uploaded stamp image (cleans it up and saves it). Without it the image is used as-is, once. */
  onStampUpload?: (file: File) => void
  onSignatureClick: () => void
  onWatermarkClick: () => void
  /** Fill & Sign: the tool armed, and picking one (arms the 'fill' mode). */
  fillTool?: FillTool
  onFillTool?: (tool: FillTool) => void
  onDeleteSelected: () => void
  /** Clears volatile pen / rectangle markups. */
  onResetMarkups: () => void
  /** True when any pen/rectangle markup exists — gates the eraser button. */
  hasMarkups: boolean
  onRunOcr: () => void
  onRunOcrAll: () => void
  onCancelOcr: () => void
  isOcrRunning: boolean
  ocrProgress: { done: number; total: number } | null
  // ── Saving ─────────────────────────────────────────────────────────────────
  // The same three for every format — the file itself, a PDF of it, and a
  // viewer exe carrying it — plus the page-only formats where there are pages.
  /** Save as PDF: first in the save menu, and Ctrl+S, whatever is open. */
  onExportPdf: () => void
  /** Save the file itself under another name (".pptx" stays a deck). */
  onSaveOriginal?: () => void
  /** Its extension, shown beside that item. */
  originalExt?: string
  /** The document is a PDF: "save the file itself" then says what that means. */
  pdfIsOriginal?: boolean
  /** The padlock: puts a password on the next save, or takes it back off. */
  onPassword: () => void
  /** True when the next save will put a password on the file. */
  saveLocked?: boolean
  /** Save the two-page view as a PDF (booklet layout). Absent where there are no pages. */
  onExportSpreads?: () => void
  /** HTML viewer and page images: page documents only. */
  onExportHtml?: () => void
  onExportImages?: () => void
  /** If undefined, the EXE option is hidden. */
  onExportExe?: () => void
  // ── Read aloud ─────────────────────────────────────────────────────────────
  /** Start or stop reading the document. Undefined outside the desktop build,
   *  where there is no speech engine, which also hides the button. */
  onToggleSpeech?: () => void
  /** Reading is under way — the button becomes a stop button. */
  isSpeaking?: boolean
  /** Shown in the title bar. Absent when no document is open. */
  fileName?: string
  /** There are changes the saved file does not have — marked beside the name. */
  unsaved?: boolean
  /** Undo / redo for annotation and page edits. Absent where nothing is undoable. */
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  /** Theme and reading colours (useAppearance). */
  appearance?: Appearance
  onAppearanceChange?: (next: Appearance) => void
  /** The document area, laid out between the title bar and the rails. */
  children?: ReactNode
}

// Phones only: a desktop window snapped to half a small screen (~680 px)
// still has room for a side rail.
const WIDE = '(min-width: 600px)'

/** A desktop-wide window (rails at the side) or a phone (bars at the bottom). */
function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window.matchMedia !== 'function' || window.matchMedia(WIDE).matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const m = window.matchMedia(WIDE)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

/**
 * The app's chrome around the document: a dark rail of tools down the left
 * (a bar along the bottom on a phone), an edit rail beside it while editing,
 * and a thin title bar in the page background's colour across the top —
 * name, page, zoom, and the window controls.
 *
 * It used to be one 48 px bar over everything with twenty controls in it,
 * folded into two hamburger menus whenever the window got narrow. Every
 * control is now one `RailItem`, which the rail, the phone's bottom bar and
 * the "..." overflow all draw the same way.
 */
export function ActionBar(props: ActionBarProps) {
  const {
    hasPdf, flowDoc, canEdit = true, pagedFlow = false, slideNotes, onSaveSlideVideo, embed = false,
    appMode, viewMode, zoom, rotation, activeMode, selectedId, isPanelOpen, onTogglePanel, isExporting,
    numPages, currentPage, onUpload, onUploadMany, onOpenUrl, onPrint, onFind, onCompare, redact, signatureBadge, onSign, onOptimize, tabs, onTab, onCloseTab, onAppModeChange, onViewModeChange,
    onZoomIn, onZoomOut, onZoomReset, onZoomSet, onFitWidth, onRotate, onRotateLeft, onModeChange,
    onStampSelect, savedStamps = [], onSavedStampSelect, onSavedStampRemove, onStampUpload,
    onSignatureClick, onWatermarkClick, onDeleteSelected, onResetMarkups, hasMarkups, fillTool, onFillTool,
    onRunOcr, onRunOcrAll, onCancelOcr, isOcrRunning, ocrProgress,
    onExportPdf, onSaveOriginal, originalExt, pdfIsOriginal = false, onPassword, saveLocked = false,
    onExportSpreads, onExportHtml, onExportImages, onExportExe,
    onToggleSpeech, isSpeaking = false, fileName, unsaved = false,
    onUndo, onRedo, canUndo = false, canRedo = false, appearance, onAppearanceChange, children,
  } = props
  // The hidden picker, held in state rather than a ref: the menus that click
  // it are built during render.
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null)
  const pickFiles = () => fileInput?.click()
  const wide = useWide()
  const axis: RailAxis = wide ? 'column' : 'row'
  const isFullscreen = viewMode === 'fullscreen'
  const anyDoc = hasPdf || flowDoc

  // Ctrl+K (and Ctrl+Shift+P, the editors' habit) opens the command palette.
  const [paletteOpen, setPaletteOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && !e.altKey && ((k === 'k' && !e.shiftKey) || (k === 'p' && e.shiftKey))) {
        e.preventDefault()
        setPaletteOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 1 && onUploadMany) onUploadMany(files)
    else if (files[0]) onUpload(files[0])
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    // The document area takes its own drops; this catches the rails and title.
    if (e.defaultPrevented) return
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).filter(f => classifyDocFile(f).supported)
    if (files.length > 1 && onUploadMany) onUploadMany(files)
    else if (files[0]) onUpload(files[0])
  }

  const handlePresetClick = async (presetId: string, svg: string, done: () => void) => {
    try {
      onStampSelect(await svgToPng(svg), presetId)
      done()
      onModeChange('stamp')
    } catch (err) {
      console.error('Failed to convert stamp SVG:', err)
    }
  }

  const handleCustomUpload = (e: React.ChangeEvent<HTMLInputElement>, done: () => void) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    done()
    if (onStampUpload) { onStampUpload(file); return }
    const reader = new FileReader()
    reader.onload = ev => {
      const result = ev.target?.result
      if (typeof result !== 'string') return
      onStampSelect(result)
      onModeChange('stamp')
    }
    reader.readAsDataURL(file)
  }

  const row = (icon: ReactNode, text: string, onClick: () => void, done: () => void, extra?: ReactNode, opts: { title?: string; className?: string; disabled?: boolean; checked?: boolean } = {}) => (
    <button
      role={opts.checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={opts.checked}
      title={opts.title}
      disabled={opts.disabled}
      onClick={() => { onClick(); done() }}
      className={`${MENU_ROW} ${opts.className ?? ''}`}
    >
      {icon}<span className="flex-1">{text}</span>{extra}
    </button>
  )
  const ext = (s: string) => <span className="text-[11px] text-gray-400">{s}</span>

  // ── The tool rail ─────────────────────────────────────────────────────────
  const items: RailItem[] = []
  const add = (item: RailItem | false | null | undefined) => { if (item) items.push(item) }

  add(!embed && {
    id: 'open', group: 'file', label: t('tool.open'), icon: <IconFolderOpen />,
    menu: done => (
      <>
        {row(<IconFolderOpen />, t('tool.openFile'), pickFiles, done)}
        {row(<IconLink />, t('tool.openUrl'), onOpenUrl, done)}
      </>
    ),
  })
  add(anyDoc && !embed && {
    id: 'save', group: 'file', label: t('tool.save'), icon: <IconSave />, disabled: isExporting,
    menu: done => (
      <>
        {row(<IconSave />, t('export.pdf'), onExportPdf, done, <kbd className="font-sans text-[11px] text-gray-400">Ctrl+S</kbd>)}
        {onSaveOriginal && row(<IconFile />, t('export.original'), onSaveOriginal, done, ext(originalExt ?? ''), { title: t(pdfIsOriginal ? 'export.originalTitlePdf' : 'export.originalTitle') })}
        {onExportSpreads && row(<IconSpread />, t('export.spread'), onExportSpreads, done, ext('.pdf'), { title: t('export.spreadTitle') })}
        {onExportHtml && row(<IconHtml />, t('export.html'), onExportHtml, done, ext('.html'))}
        {onExportImages && row(<IconImage />, t('export.images'), onExportImages, done, ext('.zip'))}
        {onOptimize && row(<IconCompress />, t('optimize.menu'), onOptimize, done, undefined, { title: t('optimize.menuTitle') })}
        {onExportExe && (
          <>
            <MenuDivider />
            {row(<IconExe />, t('export.exe'), onExportExe, done, ext('.exe'), { title: t('export.exeTitle'), className: 'text-emerald-300' })}
          </>
        )}
      </>
    ),
  })
  add(anyDoc && onPrint && { id: 'print', group: 'file', label: t('tool.print'), hint: 'Ctrl+P', icon: <IconPrint />, onClick: onPrint })
  add(onSaveSlideVideo && { id: 'video', group: 'file', label: t('video.save'), icon: <IconVideo />, onClick: onSaveSlideVideo, disabled: isExporting })

  const pages = hasPdf || pagedFlow
  add(pages && !isFullscreen && { id: 'pages', group: 'view', label: t('tool.pages'), icon: <IconPages />, onClick: onTogglePanel, active: isPanelOpen, pressed: isPanelOpen })
  add(pages && {
    id: 'layout', group: 'view', label: t('tool.layout'),
    icon: viewMode === 'spread' ? <IconSpread /> : viewMode === 'grid' ? <IconGrid /> : <IconSingle />,
    menu: done => (
      <>
        {row(<IconSingle />, t('tool.single'), () => onViewModeChange('single'), done, undefined, { checked: viewMode === 'single' })}
        {row(<IconSpread />, t('tool.spread'), () => onViewModeChange('spread'), done, undefined, { checked: viewMode === 'spread' })}
        {row(<IconGrid />, t('tool.grid'), () => onViewModeChange('grid'), done, undefined, { checked: viewMode === 'grid' })}
      </>
    ),
  })
  // Both directions: one-way rotation means three presses to undo a mis-click.
  add(hasPdf && !isFullscreen && {
    id: 'rotate', group: 'view', label: t('tool.rotateMenu', { deg: rotation }), icon: <IconRotate />, active: rotation !== 0,
    menu: done => (
      <>
        {row(<IconRotateLeft />, t('tool.rotateLeft', { deg: rotation }), onRotateLeft, done)}
        {row(<IconRotate />, t('tool.rotate', { deg: rotation }), onRotate, done)}
      </>
    ),
  })
  add(anyDoc && { id: 'fullscreen', group: 'view', label: t('tool.fullscreen'), icon: <IconFullscreen />, onClick: () => onViewModeChange('fullscreen'), active: isFullscreen })
  // Theme (the chrome) and reading colours (how pages look on screen).
  add(appearance && onAppearanceChange && {
    id: 'appearance', group: 'view', label: t('appearance.menu'), icon: <IconAppearance />,
    menu: done => (
      <>
        <div className="px-3 pb-0.5 pt-1.5 text-[11px] text-gray-400">{t('appearance.theme')}</div>
        {(['light', 'dark', 'system'] as const).map(v => row(<span className="w-4" />, t(`appearance.theme.${v}`), () => onAppearanceChange({ ...appearance, theme: v }), done, undefined, { checked: appearance.theme === v }))}
        <MenuDivider />
        <div className="px-3 pb-0.5 pt-1.5 text-[11px] text-gray-400">{t('appearance.reading')}</div>
        {(['normal', 'sepia', 'night'] as const).map(v => row(<span className="w-4" />, t(`appearance.reading.${v}`), () => onAppearanceChange({ ...appearance, reading: v }), done, undefined, { checked: appearance.reading === v }))}
      </>
    ),
  })
  add(slideNotes && !isFullscreen && { id: 'notes', group: 'view', label: t('office.notesToggle'), icon: <IconNotes />, onClick: slideNotes.onToggle, active: slideNotes.on, pressed: slideNotes.on })

  add({ id: 'palette', group: 'tools', label: t('tool.palette'), hint: 'Ctrl+K', icon: <IconCommand />, onClick: () => setPaletteOpen(true) })
  add(anyDoc && onFind && { id: 'find', group: 'tools', label: t('tool.find'), hint: 'Ctrl+F', icon: <IconSearch />, onClick: onFind })
  add(hasPdf && onCompare && !embed && { id: 'compare', group: 'tools', label: t('compare.tool'), icon: <IconCompare />, onClick: onCompare })
  add(hasPdf && {
    id: 'ocr', group: 'tools', label: t('tool.ocr'), icon: <IconOcr />,
    armed: !!ocrProgress, badge: ocrProgress ? `${ocrProgress.done}/${ocrProgress.total}` : undefined,
    menu: done => (
      <>
        {row(<IconOcr />, t('ocr.menuCurrent'), onRunOcr, done, <kbd className="font-sans text-[11px] text-gray-400">{t('ocr.keyCurrent')}</kbd>, { disabled: isOcrRunning || numPages === 0 })}
        {row(<IconOcr />, t('ocr.menuAll'), onRunOcrAll, done, <kbd className="font-sans text-[11px] text-gray-400">{t('ocr.keyAll')}</kbd>, { disabled: isOcrRunning || numPages === 0 })}
        {ocrProgress && (
          <>
            <MenuDivider />
            {row(<span className="w-4 text-center">✕</span>, t('ocr.cancel'), onCancelOcr, done, ext(`${ocrProgress.done}/${ocrProgress.total}`), { className: 'text-red-300' })}
          </>
        )}
      </>
    ),
  })
  add(onToggleSpeech && anyDoc && {
    id: 'speak', group: 'tools', label: isSpeaking ? t('tts.stop') : t('tts.read'), icon: isSpeaking ? <IconStopSpeak /> : <IconSpeak />,
    onClick: onToggleSpeech, armed: isSpeaking, pressed: isSpeaking,
  })
  // Pen and rectangle work in viewer mode too (keys 1 and 2), so clearing
  // them is not an editing action and stays on this rail.
  add(hasMarkups && !isFullscreen && { id: 'eraser', group: 'tools', label: t('tool.reset'), icon: <IconReset />, onClick: onResetMarkups })

  // Pinned at the far end: two states rather than actions.
  const pinned: RailItem[] = []
  if (!embed && canEdit && anyDoc) pinned.push({
    id: 'edit', label: t('tool.editLock'), icon: <IconPencil />, switchOn: appMode === 'editor', warn: appMode === 'editor',
    onClick: () => onAppModeChange(appMode === 'editor' ? 'viewer' : 'editor'),
  })
  // The padlock only ever means a password. It arms the next save rather than
  // saving, so its glyph reports the state the file will be written in.
  if (hasPdf && !embed) pinned.push({
    id: 'password', label: saveLocked ? t('tool.passwordRemove') : t('tool.passwordSet'),
    icon: saveLocked ? <IconLock /> : <IconLockOpen />, warn: saveLocked, disabled: isExporting, onClick: onPassword,
  })

  // ── The edit rail ─────────────────────────────────────────────────────────
  // Editing is a different job from reading, so its tools get a rail of their
  // own, shown only while editing. Their glyphs are not self-explanatory, so
  // each carries a caption.
  const editing = hasPdf && appMode === 'editor' && !isFullscreen
  const editItems: RailItem[] = []
  if (editing) {
    if (onUndo) editItems.push({ id: 'undo', group: 'history', label: t('tool.undo'), caption: t('tool.undoShort'), icon: <IconUndo />, onClick: onUndo, disabled: !canUndo })
    if (onRedo) editItems.push({ id: 'redo', group: 'history', label: t('tool.redo'), caption: t('tool.redoShort'), icon: <IconRedo />, onClick: onRedo, disabled: !canRedo })
    editItems.push(
      { id: 'select', group: 'tools', label: t('tool.select'), caption: t('tool.select'), icon: <IconSelect />, armed: activeMode === 'select', onClick: () => onModeChange('select') },
      {
        id: 'stamp', group: 'tools', label: t('tool.stamp'), caption: t('tool.stamp'), icon: <IconStamp />, armed: activeMode === 'stamp',
        menu: done => (
          <div className="flex flex-col gap-0.5 px-1">
            {STAMP_PRESETS.map(p => (
              <button key={p.id} role="menuitem" onClick={() => { void handlePresetClick(p.id, p.svg, done) }}
                className="whitespace-nowrap rounded px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-700">{p.label}</button>
            ))}
            {savedStamps.length > 0 && onSavedStampSelect && (
              <>
                <div className="mt-1 border-t border-gray-600 px-3 pb-0.5 pt-1.5 text-[11px] text-gray-400">{t('stamp.mine')}</div>
                {savedStamps.map(s => (
                  <div key={s.id} className="group flex items-center rounded hover:bg-gray-700">
                    <button onClick={() => { onSavedStampSelect(s); done() }} title={s.name}
                      className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-200">
                      {/* A light tile, so a dark or red seal on transparency shows on the dark menu. */}
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-white/90">
                        <img src={s.src} alt="" className="max-h-6 max-w-6 object-contain" />
                      </span>
                      <span className="truncate">{s.name}</span>
                    </button>
                    {onSavedStampRemove && (
                      <button onClick={() => onSavedStampRemove(s.id)}
                        aria-label={t('stamp.remove', { name: s.name })} title={t('stamp.remove', { name: s.name })}
                        className="mr-1 shrink-0 rounded p-1 text-gray-400 opacity-0 hover:bg-gray-600 hover:text-gray-100 focus:opacity-100 group-hover:opacity-100">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    )}
                  </div>
                ))}
                <div className="mb-0.5 border-t border-gray-600" />
              </>
            )}
            <label className="cursor-pointer rounded px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-700">
              {t('stamp.uploadImage')}
              <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={e => handleCustomUpload(e, done)} />
            </label>
          </div>
        ),
      },
      { id: 'signature', group: 'tools', label: t('tool.signature'), caption: t('tool.signature'), icon: <IconSignature />, armed: activeMode === 'signature', onClick: () => { onModeChange('signature'); onSignatureClick() } },
      { id: 'watermark', group: 'tools', label: t('tool.watermark'), caption: t('tool.watermark'), icon: <IconWatermark />, armed: activeMode === 'watermark', onClick: () => { onModeChange('watermark'); onWatermarkClick() } },
      // Fill & Sign: typed text, ✓ ✕ ● ─ and today's date, placed by a click.
      ...(onFillTool ? [{
        id: 'fill', group: 'tools', label: t('fill.menu'), caption: t('fill.short'), icon: <IconFill />, armed: activeMode === 'fill',
        menu: (done: () => void) => (
          <>
            {FILL_TOOLS.map(tool => row(<span className="w-4 text-center" aria-hidden>{FILL_GLYPH[tool]}</span>, t(`fill.tool.${tool}`), () => onFillTool(tool), done, undefined,
              { checked: activeMode === 'fill' && fillTool === tool }))}
          </>
        ),
      } satisfies RailItem] : []),
      // A digital signature with a certificate file.
      ...(onSign ? [{ id: 'sign', group: 'tools', label: t('sign.tool'), caption: t('sign.short'), icon: <IconCertificate />, armed: activeMode === 'signArea', onClick: onSign } satisfies RailItem] : []),
      // Redaction: mark words or areas, then apply — which removes them.
      ...(redact ? [{
        id: 'redact', group: 'tools', label: t('redact.menu'), caption: t('redact.short'), icon: <IconRedact />,
        armed: activeMode === 'redact' || activeMode === 'redactArea', badge: redact.pending ? String(redact.pending) : undefined,
        menu: (done: () => void) => (
          <>
            {row(<span className="w-4" />, t('redact.markText'), () => redact.onArm('redact'), done, undefined, { checked: activeMode === 'redact' })}
            {row(<span className="w-4" />, t('redact.markArea'), () => redact.onArm('redactArea'), done, undefined, { checked: activeMode === 'redactArea' })}
            {row(<span className="w-4" />, t('redact.find'), redact.onFind, done)}
            <MenuDivider />
            {row(<span className="w-4" />, t('redact.applyN', { n: redact.pending }), redact.onApply, done, undefined, { disabled: redact.pending === 0, className: redact.pending ? 'text-red-300' : '' })}
            {row(<span className="w-4" />, t('redact.clear'), redact.onClear, done, undefined, { disabled: redact.pending === 0 })}
          </>
        ),
      } satisfies RailItem] : []),
      // Comments: the three marks are made by selecting text with the tool
      // armed; a note by clicking where it goes. A second press puts it down.
      { id: 'highlight', group: 'comments', label: t('tool.highlightHint'), caption: t('tool.highlight'), icon: <IconHighlight />, armed: activeMode === 'highlight', onClick: () => onModeChange(activeMode === 'highlight' ? 'select' : 'highlight') },
      { id: 'underline', group: 'comments', label: t('tool.underlineHint'), caption: t('tool.underline'), icon: <IconUnderline />, armed: activeMode === 'underline', onClick: () => onModeChange(activeMode === 'underline' ? 'select' : 'underline') },
      { id: 'strikeout', group: 'comments', label: t('tool.strikeoutHint'), caption: t('tool.strikeout'), icon: <IconStrike />, armed: activeMode === 'strikeout', onClick: () => onModeChange(activeMode === 'strikeout' ? 'select' : 'strikeout') },
      { id: 'note', group: 'comments', label: t('tool.noteHint'), caption: t('tool.note'), icon: <IconNote />, armed: activeMode === 'note', onClick: () => onModeChange(activeMode === 'note' ? 'select' : 'note') },
    )
    if (selectedId) editItems.push({ id: 'delete', group: 'delete', label: t('tool.delete'), caption: t('tool.delete'), hint: 'Delete', icon: <IconDelete />, danger: true, onClick: onDeleteSelected })
  }

  // ── The command palette's list ────────────────────────────────────────────
  // Every action the rail, its menus and the edit rail offer, flat, with the
  // same conditions — one list, so the palette can never offer what the rail
  // would hide.
  const commands: PaletteCommand[] = []
  const G = { file: t('palette.groupFile'), view: t('palette.groupView'), tools: t('palette.groupTools'), edit: t('palette.groupEdit') }
  const cmd = (
    on: unknown, id: string, key: MessageKey, group: string, run: () => void,
    o: { vars?: Record<string, string | number>; shortcut?: string; icon?: ReactNode; disabled?: boolean; keywords?: string } = {},
  ) => {
    if (!on) return
    commands.push({ id, label: t(key, o.vars), alt: tEnglish(key, o.vars), group, run, shortcut: o.shortcut, icon: o.icon, disabled: o.disabled, keywords: o.keywords })
  }
  cmd(!embed, 'open-file', 'tool.openFile', G.file, pickFiles, { shortcut: 'F2', icon: <IconFolderOpen /> })
  cmd(!embed, 'open-url', 'tool.openUrl', G.file, onOpenUrl, { icon: <IconLink /> })
  cmd(anyDoc && !embed, 'save-pdf', 'export.pdf', G.file, onExportPdf, { shortcut: 'Ctrl+S', icon: <IconSave />, disabled: isExporting })
  cmd(anyDoc && !embed && onSaveOriginal, 'save-original', 'export.original', G.file, () => onSaveOriginal?.(), { icon: <IconFile />, disabled: isExporting })
  cmd(anyDoc && !embed && onExportSpreads, 'save-booklet', 'export.spread', G.file, () => onExportSpreads?.(), { icon: <IconSpread />, disabled: isExporting })
  cmd(anyDoc && !embed && onExportHtml, 'save-html', 'export.html', G.file, () => onExportHtml?.(), { icon: <IconHtml />, disabled: isExporting })
  cmd(anyDoc && !embed && onOptimize, 'optimize', 'optimize.menu', G.file, () => onOptimize?.(), { icon: <IconCompress />, keywords: 'optimize compress reduce size 용량 압축 줄이기' })
  cmd(anyDoc && !embed && onExportImages, 'save-images', 'export.images', G.file, () => onExportImages?.(), { icon: <IconImage />, disabled: isExporting })
  cmd(anyDoc && !embed && onExportExe, 'save-exe', 'export.exe', G.file, () => onExportExe?.(), { icon: <IconExe />, disabled: isExporting })
  cmd(onSaveSlideVideo, 'save-video', 'video.save', G.file, () => onSaveSlideVideo?.(), { icon: <IconVideo />, disabled: isExporting })
  cmd(anyDoc && onPrint, 'print', 'tool.print', G.file, () => onPrint?.(), { shortcut: 'Ctrl+P', icon: <IconPrint /> })
  cmd(pages && !isFullscreen, 'page-list', 'tool.pages', G.view, onTogglePanel, { icon: <IconPages /> })
  cmd(pages, 'layout-single', 'tool.single', G.view, () => onViewModeChange('single'), { icon: <IconSingle /> })
  cmd(pages, 'layout-spread', 'tool.spread', G.view, () => onViewModeChange('spread'), { icon: <IconSpread /> })
  cmd(pages, 'layout-grid', 'tool.grid', G.view, () => onViewModeChange('grid'), { icon: <IconGrid /> })
  cmd(anyDoc, 'fullscreen', 'palette.fullscreen', G.view, () => onViewModeChange('fullscreen'), { shortcut: 'F5', icon: <IconFullscreen /> })
  cmd(anyDoc && !isFullscreen, 'zoom-in', 'tool.zoomIn', G.view, onZoomIn, { shortcut: 'Ctrl++', icon: <IconZoomIn /> })
  cmd(anyDoc && !isFullscreen, 'zoom-out', 'tool.zoomOut', G.view, onZoomOut, { shortcut: 'Ctrl+-', icon: <IconZoomOut /> })
  cmd(anyDoc && !isFullscreen, 'zoom-reset', 'palette.zoomReset', G.view, onZoomReset)
  cmd(anyDoc && !isFullscreen, 'fit-width', 'tool.fitWidth', G.view, onFitWidth, { icon: <IconFitWidth /> })
  cmd(hasPdf && !isFullscreen, 'rotate-left', 'tool.rotateLeft', G.view, onRotateLeft, { vars: { deg: rotation }, icon: <IconRotateLeft /> })
  cmd(hasPdf && !isFullscreen, 'rotate-right', 'tool.rotate', G.view, onRotate, { vars: { deg: rotation }, icon: <IconRotate /> })
  cmd(slideNotes, 'speaker-notes', 'office.notesToggle', G.view, () => slideNotes?.onToggle(), { icon: <IconNotes /> })
  cmd(anyDoc && onFind, 'find', 'tool.find', G.tools, () => onFind?.(), { shortcut: 'Ctrl+F', icon: <IconSearch /> })
  cmd(hasPdf && onCompare && !embed, 'compare', 'compare.tool', G.tools, () => onCompare?.(), { icon: <IconCompare />, keywords: 'compare diff 비교 차이 버전' })
  cmd(hasPdf, 'ocr-page', 'ocr.menuCurrent', G.tools, onRunOcr, { shortcut: 'R', icon: <IconOcr />, disabled: isOcrRunning || numPages === 0, keywords: 'ocr' })
  cmd(hasPdf, 'ocr-all', 'ocr.menuAll', G.tools, onRunOcrAll, { shortcut: 'R R', icon: <IconOcr />, disabled: isOcrRunning || numPages === 0, keywords: 'ocr' })
  cmd(ocrProgress, 'ocr-cancel', 'ocr.cancel', G.tools, onCancelOcr)
  cmd(onToggleSpeech && anyDoc, 'read-aloud', isSpeaking ? 'tts.stop' : 'tts.read', G.tools, () => onToggleSpeech?.(), { icon: isSpeaking ? <IconStopSpeak /> : <IconSpeak />, keywords: 'tts' })
  cmd(hasMarkups, 'clear-markups', 'tool.reset', G.tools, onResetMarkups, { shortcut: 'Esc', icon: <IconReset /> })
  cmd(!embed && canEdit && anyDoc, 'toggle-edit', appMode === 'editor' ? 'palette.editOff' : 'palette.editOn', G.edit, () => onAppModeChange(appMode === 'editor' ? 'viewer' : 'editor'), { icon: <IconPencil /> })
  cmd(hasPdf && !embed, 'password', saveLocked ? 'tool.passwordRemove' : 'tool.passwordSet', G.edit, onPassword, { icon: saveLocked ? <IconLock /> : <IconLockOpen />, disabled: isExporting })
  for (const item of editItems) {
    if (item.menu) continue
    commands.push({ id: `edit-${item.id}`, label: item.caption ?? item.label, alt: undefined, group: G.edit, run: () => item.onClick?.(), shortcut: item.hint, icon: item.icon, disabled: item.disabled })
  }
  cmd(true, 'help', 'palette.help', G.tools, openHelp, { shortcut: 'F1' })
  if (appearance && onAppearanceChange) {
    for (const v of ['light', 'dark', 'system'] as const) {
      cmd(appearance.theme !== v, `theme-${v}`, `appearance.cmd.theme.${v}`, G.view, () => onAppearanceChange({ ...appearance, theme: v }), { keywords: 'theme dark mode 테마 다크' })
    }
    for (const v of ['normal', 'sepia', 'night'] as const) {
      cmd(appearance.reading !== v, `reading-${v}`, `appearance.cmd.reading.${v}`, G.view, () => onAppearanceChange({ ...appearance, reading: v }), { keywords: 'reading colours 읽기 색' })
    }
  }

  // ── The title bar's right end: where in the document, and how big ─────────
  const counter = pages && !isFullscreen ? (
    <span className="px-1 text-xs text-gray-600 dark:text-gray-300 tabular-nums whitespace-nowrap" aria-label={t('tool.pageOf', { n: currentPage, total: numPages })}>
      {currentPage} / {numPages}
    </span>
  ) : null
  const zoomControls = anyDoc && !isFullscreen && viewMode !== 'grid' ? (
    <>
      <ZoomControl tone="light" zoom={zoom} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onZoomSet={onZoomSet} onZoomReset={onZoomReset} />
      <button onClick={onFitWidth} title={t('tool.fitWidth')} aria-label={t('tool.fitWidth')}
        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-600 dark:text-gray-300 hover:bg-black/10 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white">
        <IconFitWidth />
      </button>
    </>
  ) : null

  // The logo heads the rail on a desktop, and is the window's drag handle there.
  const logo = (
    <div className="wz-drag flex h-12 w-full shrink-0 items-center justify-center" title={`WZ Reader v${__APP_VERSION__}`}>
      <img src="./icon.svg" alt="WZ Reader" className="h-7 w-7 rounded-md" draggable={false} />
    </div>
  )

  const toolRail = (
    <ToolRail axis={axis} items={items} pinned={pinned} label={t('tool.rail')} head={wide ? logo : undefined} />
  )
  const editRail = editItems.length > 0 ? (
    <ToolRail axis={axis} items={editItems} label={t('tool.editTools')} shade="raised" />
  ) : null

  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden"
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
    >
      {wide && toolRail}
      {wide && editRail}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TitleBar name={fileName} unsaved={unsaved} badge={signatureBadge} right={<>{counter}{zoomControls}</>}
          tabs={tabs} onTab={onTab} onCloseTab={onCloseTab} />
        {children}
        {!wide && editRail}
        {!wide && toolRail}
      </div>
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      {/* Mounted always: a live region announces only what changes while it exists. */}
      <OcrAnnouncer progress={ocrProgress} />
      {!embed && <input ref={setFileInput} type="file" multiple accept={DOCUMENT_ACCEPT} className="hidden" onChange={handleFileChange} />}
    </div>
  )
}
