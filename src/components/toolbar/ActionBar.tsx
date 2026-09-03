import React, { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import type { AppMode, ViewMode } from '../../types/viewModes'
import type { ActiveMode } from '../../types/annotation'
import { STAMP_PRESETS, svgToPng } from '../../utils/stampPresets'
import { classifyDocFile } from '../../utils/detectDocType'
import { t } from '../../i18n'
import { DOCUMENT_ACCEPT } from '../../utils/detectDocType'
import {
  IconSingle, IconSpread, IconGrid, IconFullscreen, IconRotate, IconSelect,
  IconStamp, IconSignature, IconWatermark, IconDelete, IconUpload, IconLink,
  IconDownload, IconHtml, IconImage, IconChevron, IconPrint, IconOcr, IconReset,
  IconExe, IconLock, IconLockOpen, IconPencil, IconMenu, IconMore, IconFitWidth,
  IconSpeak, IconStopSpeak, IconRotateLeft,
} from './icons'
import { OcrAnnouncer } from '../OcrAnnouncer'
import { Sep, BTN_BASE, BTN_IDLE, BTN_ACTIVE, BTN_ARMED, TITLE_MIN_WIDTH, TITLE_GUTTER } from './toolbarStyles'
import { ZoomControl } from './ZoomControl'
import { useToolbarCollapse } from '../../hooks/useToolbarCollapse'

export interface ActionBarProps {
  /** A page-based document is open (PDF / HWP / image) — the ViewerDoc pipeline. */
  hasPdf: boolean
  /** A reflowing document is open (Markdown / mail). It has no pages, so only
   *  the controls that mean something without page geometry are shown. */
  flowDoc: boolean
  /** Embed mode (?embed): hide file-open, export and the viewer/editor toggle
   *  so the toolbar is a clean read-only viewer for website embedding. */
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
  /** Open the "load from URL" modal. */
  onOpenUrl: () => void
  onPrint: () => void
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
  onSignatureClick: () => void
  onWatermarkClick: () => void
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
  // ── Export menu ────────────────────────────────────────────────────────────
  onExportPdf: () => void
  /** The padlock: puts a password on the next save, or takes it back off. */
  onPassword: () => void
  /** True when the next save will put a password on the file. */
  saveLocked?: boolean
  onExportHtml: () => void
  onExportImages: () => void
  /** If undefined, the EXE option is hidden (only available in Electron builds). */
  onExportExe?: () => void
  // ── Read aloud ─────────────────────────────────────────────────────────────
  /** Start or stop reading the document. Undefined outside the desktop build,
   *  where there is no speech engine, which also hides the button. */
  onToggleSpeech?: () => void
  /** Reading is under way — the button becomes a stop button. */
  isSpeaking?: boolean
  /** Shown centred in the title bar. Absent when no document is open. */
  fileName?: string
}

export function ActionBar({
  hasPdf,
  flowDoc,
  embed = false,
  appMode,
  viewMode,
  zoom,
  rotation,
  activeMode,
  selectedId,
  isPanelOpen,
  onTogglePanel,
  isExporting,
  numPages,
  currentPage,
  onUpload,
  onOpenUrl,
  onPrint,
  onAppModeChange,
  onViewModeChange,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onZoomSet,
  onFitWidth,
  onRotate,
  onRotateLeft,
  onModeChange,
  onStampSelect,
  onSignatureClick,
  onWatermarkClick,
  onDeleteSelected,
  onResetMarkups,
  hasMarkups,
  onRunOcr,
  onRunOcrAll,
  onCancelOcr,
  isOcrRunning,
  ocrProgress,
  onExportPdf,
  onPassword,
  saveLocked = false,
  onExportHtml,
  onExportImages,
  onExportExe,
  onToggleSpeech,
  isSpeaking = false,
  fileName,
}: ActionBarProps) {
  const [stampPanelOpen, setStampPanelOpen] = useState(false)
  const [stampMenuRect, setStampMenuRect] = useState<DOMRect | null>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [openMenuOpen, setOpenMenuOpen] = useState(false)
  const [leftMenuOpen, setLeftMenuOpen] = useState(false)
  const [rightMenuOpen, setRightMenuOpen] = useState(false)
  const fileInputRef  = useRef<HTMLInputElement>(null)
  const stampBtnRef   = useRef<HTMLButtonElement>(null)
  const stampPortalRef = useRef<HTMLDivElement>(null)
  const exportRef     = useRef<HTMLDivElement>(null)
  const openRef       = useRef<HTMLDivElement>(null)
  const leftClusterRef  = useRef<HTMLDivElement>(null)
  const rightClusterRef = useRef<HTMLDivElement>(null)
  const titleRef        = useRef<HTMLDivElement>(null)
  const leftMenuRef   = useRef<HTMLDivElement>(null)
  const rightMenuRef  = useRef<HTMLDivElement>(null)

  const isFullscreen = viewMode === 'fullscreen'

  // Re-measure the toolbar whenever the visible control set changes.
  const contentKey = [
    hasPdf, flowDoc, embed, appMode, viewMode, !!selectedId, hasMarkups, !!ocrProgress, !!onExportExe,
  ].join('|')
  const { ref: headerRef, collapsed } = useToolbarCollapse(contentKey)

  // Close a dropdown when clicking outside of it. The stamp portal lives in
  // <body>, so it checks both its portal node and its trigger button.
  useEffect(() => {
    if (!stampPanelOpen) return
    const onMouseDown = (e: MouseEvent) => {
      const inPortal = stampPortalRef.current?.contains(e.target as Node)
      const inBtn    = stampBtnRef.current?.contains(e.target as Node)
      if (!inPortal && !inBtn) setStampPanelOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [stampPanelOpen])

  useEffect(() => {
    const menus: [boolean, React.RefObject<HTMLElement | null>, (v: boolean) => void][] = [
      [exportMenuOpen, exportRef, setExportMenuOpen],
      [openMenuOpen, openRef, setOpenMenuOpen],
      [leftMenuOpen, leftMenuRef, setLeftMenuOpen],
      [rightMenuOpen, rightMenuRef, setRightMenuOpen],
    ]
    const active = menus.filter(([open]) => open)
    if (active.length === 0) return
    const onMouseDown = (e: MouseEvent) => {
      for (const [, ref, set] of active) {
        if (ref.current && !ref.current.contains(e.target as Node)) set(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [exportMenuOpen, openMenuOpen, leftMenuOpen, rightMenuOpen])

  // Switching between the inline and collapsed layouts hides the other mode's
  // dropdowns; reset them so a stale-open menu doesn't reappear on switch back.
  useEffect(() => {
    const close = collapsed
      ? [setExportMenuOpen, setOpenMenuOpen]
      : [setLeftMenuOpen, setRightMenuOpen]
    close.forEach(fn => fn(false))
  }, [collapsed])

  /**
   * Fit the centred file name to whatever gap the two clusters leave, and hide
   * it when there is not one.
   *
   * A breakpoint cannot answer this: the clusters' widths depend on the format,
   * the mode and whether anything is selected, so the same window width has a
   * different amount of room from one document to the next — which is how the
   * name ended up printed straight through the rotate buttons. Because the name
   * is centred on the *bar*, it can only stay clear of both clusters if it is
   * narrower than `barWidth - 2 x widerCluster`; that is the number measured
   * here.
   *
   * Applied to the node rather than to state on purpose: this runs on every
   * resize, and a re-render per frame to set one width is waste.
   */
  useLayoutEffect(() => {
    const header = headerRef.current
    const title = titleRef.current
    if (!header || !title) return

    const fit = () => {
      const left = leftClusterRef.current?.offsetWidth ?? 0
      const right = rightClusterRef.current?.offsetWidth ?? 0
      const bar = header.clientWidth
      const room = Math.min(bar - 2 * left, bar - 2 * right) - TITLE_GUTTER
      const el = titleRef.current
      if (!el) return
      if (room < TITLE_MIN_WIDTH) {
        el.style.visibility = 'hidden'
        return
      }
      el.style.visibility = 'visible'
      const span = el.firstElementChild as HTMLElement | null
      if (span) span.style.maxWidth = `${Math.floor(room)}px`
    }

    fit()
    // Both, deliberately. ResizeObserver catches the bar changing width without
    // the window doing so (the page panel opening, a cluster growing); the
    // window listener catches the case where the observer is deferred, which
    // Chromium does for a window that is not on screen.
    window.addEventListener('resize', fit)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    ro?.observe(header)
    return () => {
      window.removeEventListener('resize', fit)
      ro?.disconnect()
    }
  }, [headerRef, collapsed, contentKey, fileName])

  const openStampMenu = () => {
    if (stampPanelOpen) { setStampPanelOpen(false); return }
    if (stampBtnRef.current) setStampMenuRect(stampBtnRef.current.getBoundingClientRect())
    setStampPanelOpen(true)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onUpload(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && classifyDocFile(file).supported) onUpload(file)
  }

  const handlePresetClick = async (presetId: string, svg: string) => {
    try {
      const pngDataUrl = await svgToPng(svg)
      onStampSelect(pngDataUrl, presetId)
      setStampPanelOpen(false)
      onModeChange('stamp')
    } catch (err) {
      console.error('Failed to convert stamp SVG:', err)
    }
  }

  const handleCustomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const result = ev.target?.result
      if (typeof result !== 'string') return
      onStampSelect(result)
      setStampPanelOpen(false)
      onModeChange('stamp')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // ── Button style helpers ──────────────────────────────────────────────────
  const viewBtn = (mode: ViewMode) =>
    `${BTN_BASE} ${viewMode === mode ? BTN_ACTIVE : BTN_IDLE}`
  const toolBtn = (mode: ActiveMode) =>
    `${BTN_BASE} ${activeMode === mode ? BTN_ARMED : BTN_IDLE}`
  const iconBtn = (extra = '') => `${BTN_BASE} ${BTN_IDLE} ${extra}`

  // ── Reusable control clusters (shared by the bar and the collapsed menus) ──
  const brandingCluster = (
    <div className="flex items-center gap-2.5 px-1.5 py-0.5 select-none">
      <img src="./icon.svg" alt="" className="w-7 h-7 rounded-md shrink-0" draggable={false} />
      <span className="text-lg font-bold tracking-tight bg-gradient-to-br from-sky-400 to-violet-400 bg-clip-text text-transparent leading-none">
        WZ PDF
      </span>
      <span className="hidden sm:inline text-xs text-gray-500 ml-1">{t('app.tagline')}</span>
      <span
        className="ml-1 rounded-full border border-gray-700 px-2 py-px text-[10px] font-medium text-gray-400 tabular-nums"
        title="App version"
      >
        v{__APP_VERSION__}
      </span>
    </div>
  )

  // Split out because a reflowing document gets this button and nothing else
  // from the view cluster: single / spread / grid are all page arrangements.
  const fullscreenButton = (
    <button className={viewBtn('fullscreen')} onClick={() => onViewModeChange('fullscreen')} title={t('tool.fullscreen')} aria-label={t('tool.fullscreen')}><IconFullscreen /></button>
  )

  const viewCluster = (
    <div className="flex items-center gap-0.5 shrink-0">
      <button className={viewBtn('single')}     onClick={() => onViewModeChange('single')}     title={t('tool.single')}     aria-label={t('tool.single')}><IconSingle /></button>
      <button className={viewBtn('spread')}     onClick={() => onViewModeChange('spread')}     title={t('tool.spread')}     aria-label={t('tool.spread')}><IconSpread /></button>
      <button className={viewBtn('grid')}       onClick={() => onViewModeChange('grid')}       title={t('tool.grid')}       aria-label={t('tool.grid')}><IconGrid /></button>
      {fullscreenButton}
    </div>
  )

  const pageCounter = (
    <span className="text-xs text-gray-400 tabular-nums shrink-0 px-1 min-w-[56px] text-center">
      {currentPage} / {numPages}
    </span>
  )

  const zoomCluster = (
    <div className="flex items-center gap-0.5 shrink-0">
      <ZoomControl zoom={zoom} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onZoomSet={onZoomSet} onZoomReset={onZoomReset} />
      <button
        onClick={onFitWidth}
        className={iconBtn()}
        title={t('tool.fitWidth')}
        aria-label={t('tool.fitWidth')}
      ><IconFitWidth /></button>
    </div>
  )

  // Both directions. One-way rotation means three presses to undo a mis-click,
  // which is exactly when someone is most annoyed by it.
  const rotateButton = (
    <div className="flex items-center gap-0.5 shrink-0">
      <button
        onClick={onRotateLeft}
        className={`${iconBtn()} ${rotation !== 0 ? 'text-blue-400' : ''}`}
        title={t('tool.rotateLeft', { deg: rotation })}
        aria-label={t('tool.rotateLeft', { deg: rotation })}
      ><IconRotateLeft /></button>
      <button
        onClick={onRotate}
        className={`${iconBtn()} ${rotation !== 0 ? 'text-blue-400' : ''}`}
        title={t('tool.rotate', { deg: rotation })}
        aria-label={t('tool.rotate', { deg: rotation })}
      ><IconRotate /></button>
    </div>
  )

  const pagesButton = (
    <button
      className={`${BTN_BASE} ${isPanelOpen ? BTN_ACTIVE : BTN_IDLE} shrink-0`}
      onClick={onTogglePanel}
      title={t('tool.pages')}
      aria-label={t('tool.pages')}
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4">
        <rect x="2" y="3" width="7" height="14" rx="1"/>
        <path d="M13 6h4M13 10h4M13 14h4" strokeLinecap="round"/>
      </svg>
    </button>
  )

  const eraserButton = hasMarkups ? (
    <button className={iconBtn()} onClick={onResetMarkups} title={t('tool.reset')} aria-label={t('tool.reset')}>
      <IconReset />
    </button>
  ) : null

  const editorCluster = (
    <div className="flex items-center gap-0.5 shrink-0">
      <button
        className={toolBtn('select')}
        onClick={() => { onModeChange('select'); setStampPanelOpen(false) }}
        title={t('tool.select')}
        aria-label={t('tool.select')}
      ><IconSelect /></button>
      <button
        ref={stampBtnRef}
        className={toolBtn('stamp')}
        onClick={openStampMenu}
        title={t('tool.stamp')}
        aria-label={t('tool.stamp')}
        aria-expanded={stampPanelOpen}
      ><IconStamp /></button>
      <button
        className={toolBtn('signature')}
        onClick={() => { onModeChange('signature'); onSignatureClick(); setStampPanelOpen(false) }}
        title={t('tool.signature')}
        aria-label={t('tool.signature')}
      ><IconSignature /></button>
      <button
        className={toolBtn('watermark')}
        onClick={() => { onModeChange('watermark'); onWatermarkClick(); setStampPanelOpen(false) }}
        title={t('tool.watermark')}
        aria-label={t('tool.watermark')}
      ><IconWatermark /></button>
      {selectedId && (
        <button
          onClick={onDeleteSelected}
          className={`${BTN_BASE} bg-red-700 hover:bg-red-600 text-white`}
          title={t('tool.delete')}
          aria-label={t('tool.delete')}
        ><IconDelete /></button>
      )}
    </div>
  )

  // Viewer/editor is a MODE, not just another toggle button, so it gets a
  // segmented-switch treatment: a recessed track with a single sliding thumb.
  // The thumb is one element that translates between the two halves, which is
  // what makes it read as a switch rather than as two independent icon buttons.
  // The glyph is a pencil in both states and the amber wash carries on/off,
  // because a padlock now means what it says everywhere else in this app: a
  // password. Two different locks in one bar was the confusing part.
  const modeToggleCluster = !embed ? (
    <button
      role="switch"
      aria-checked={appMode === 'editor'}
      aria-label={t('tool.editLock')}
      title={appMode === 'editor' ? t('tool.editor') : t('tool.viewer')}
      onClick={() => onAppModeChange(appMode === 'editor' ? 'viewer' : 'editor')}
      className={`${BTN_BASE} ${
        appMode === 'editor'
          ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
          : BTN_IDLE
      }`}
    >
      <IconPencil />
    </button>
  ) : null

  // The padlock, and now it only ever means one thing: a password. It arms the
  // next save rather than saving, so the glyph reports the state the file will
  // be written in — closed means the save will lock it. PDF only: it is the one
  // format whose bytes this app can encrypt.
  const passwordButton = (hasPdf && !embed) ? (
    <button
      onClick={onPassword}
      disabled={isExporting}
      className={`${BTN_BASE} ${saveLocked ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : BTN_IDLE}`}
      title={saveLocked ? t('tool.passwordRemove') : t('tool.passwordSet')}
      aria-label={saveLocked ? t('tool.passwordRemove') : t('tool.passwordSet')}
    >{saveLocked ? <IconLock /> : <IconLockOpen />}</button>
  ) : null

  // A plain ghost button like every other tool. It used to carry a filled grey
  // pill, which made it the only control in the bar that looked like something
  // you were supposed to press.
  const printButton = (hasPdf || flowDoc) ? (
    <button
      onClick={onPrint}
      className={iconBtn()}
      title={t('tool.print')}
      aria-label={t('tool.print')}
    ><IconPrint /></button>
  ) : null

  const speakButton = (onToggleSpeech && (hasPdf || flowDoc)) ? (
    <button
      type="button"
      onClick={onToggleSpeech}
      aria-label={isSpeaking ? t('tts.stop') : t('tts.read')}
      title={isSpeaking ? t('tts.stop') : t('tts.read')}
      aria-pressed={isSpeaking}
      className={`${BTN_BASE} ${isSpeaking ? BTN_ARMED : BTN_IDLE}`}
    >{isSpeaking ? <IconStopSpeak /> : <IconSpeak />}</button>
  ) : null

  const ocrCluster = hasPdf ? (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={onRunOcr}
        disabled={isOcrRunning || numPages === 0}
        aria-label={t('ocr.runCurrent')}
        title={t('ocr.runCurrent')}
        className="p-2 rounded hover:bg-gray-700 disabled:opacity-40 text-gray-200"
      ><IconOcr /></button>
      <button
        type="button"
        onClick={onRunOcrAll}
        disabled={isOcrRunning || numPages === 0}
        aria-label={t('ocr.runAll')}
        title={t('ocr.runAll')}
        className="px-1 text-[10px] rounded hover:bg-gray-700 disabled:opacity-40 text-gray-300"
      >ALL</button>
      {/* Recognising a scanned document takes minutes, and the only sign of it
          was this bare "12/30". For a reader who cannot see it that was minutes
          of silence with no way to tell progress from a hang. */}
      <OcrAnnouncer progress={ocrProgress} />
      {ocrProgress && (
        <span className="ml-1 text-[10px] text-gray-400 tabular-nums" aria-hidden>
          {ocrProgress.done}/{ocrProgress.total}
        </span>
      )}
      {ocrProgress && (
        <button
          type="button"
          onClick={onCancelOcr}
          aria-label={t('ocr.cancel')}
          title={t('ocr.cancel')}
          className="ml-1 px-1 text-[10px] rounded hover:bg-gray-700 text-red-300"
        >✕</button>
      )}
    </div>
  ) : null

  // ── Stamp portal menu ─────────────────────────────────────────────────────
  const stampPortal = stampPanelOpen && stampMenuRect
    ? createPortal(
        <div
          ref={stampPortalRef}
          style={{ position: 'fixed', top: stampMenuRect.bottom + 4, left: stampMenuRect.left, zIndex: 9999 }}
          className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-1 flex flex-col gap-0.5 min-w-[140px]"
        >
          {STAMP_PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => { handlePresetClick(p.id, p.svg) }}
              className="text-xs text-left px-3 py-1.5 hover:bg-gray-700 rounded text-gray-200 whitespace-nowrap"
            >{p.label}</button>
          ))}
          <label className="text-xs text-left px-3 py-1.5 hover:bg-gray-700 rounded cursor-pointer text-gray-200">
            {t('stamp.uploadImage')}
            <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleCustomUpload} />
          </label>
        </div>,
        document.body,
      )
    : null

  // ── Export dropdown menu body (shared by the split button & collapsed menu) ─
  const exportMenuItems = (onDone: () => void) => (
    <>
      <button onClick={() => { onExportPdf(); onDone() }} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors">
        <IconDownload /><span>{t('export.pdf')}</span><span className="ml-auto text-gray-500 text-[10px]">.pdf</span>
      </button>
      <button onClick={() => { onExportHtml(); onDone() }} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors">
        <IconHtml /><span>{t('export.html')}</span><span className="ml-auto text-gray-500 text-[10px]">.html</span>
      </button>
      <button onClick={() => { onExportImages(); onDone() }} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors">
        <IconImage /><span>{t('export.images')}</span><span className="ml-auto text-gray-500 text-[10px]">.zip</span>
      </button>
      {onExportExe && (
        <>
          <div className="my-1 border-t border-gray-600" />
          <button onClick={() => { onExportExe(); onDone() }} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-emerald-300 hover:bg-gray-700 transition-colors">
            <IconExe /><span>{t('export.exe')}</span><span className="ml-auto text-gray-500 text-[10px]">.exe</span>
          </button>
        </>
      )}
    </>
  )

  // ── Expanded (inline) sections ─────────────────────────────────────────────
  const expandedLeft = (
    <div ref={leftClusterRef} className="relative flex items-center gap-0.5 px-2 py-1.5 min-w-0 shrink-0">
      {!hasPdf && brandingCluster}
      {flowDoc && !isFullscreen && (<><Sep />{fullscreenButton}<Sep />{zoomCluster}</>)}
      {hasPdf && (
        <>
          {viewCluster}
          {!isFullscreen && (<><Sep />{pageCounter}</>)}
          {!isFullscreen && viewMode !== 'grid' && (<><Sep />{zoomCluster}</>)}
          {!isFullscreen && (<><Sep />{rotateButton}</>)}
          {!isFullscreen && (<><Sep />{pagesButton}{eraserButton}</>)}
        </>
      )}
    </div>
  )

  const expandedRight = (
    <div ref={rightClusterRef} className="relative flex items-center gap-0.5 px-1.5 sm:px-2 py-1.5 shrink-0 border-l border-gray-700/40">
      {modeToggleCluster}
      {modeToggleCluster && <Sep />}

      {/* Open dropdown — file or URL. Hidden in embed mode. */}
      {!embed && (
        <div ref={openRef} className="relative">
          <button
            onClick={() => setOpenMenuOpen(v => !v)}
            aria-expanded={openMenuOpen}
            className={`${BTN_BASE} ${openMenuOpen ? BTN_ACTIVE : BTN_IDLE}`}
            title={t('tool.open')}
            aria-label={t('tool.open')}
          ><IconUpload /></button>
          {openMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50 min-w-[170px]">
              <button onClick={() => { fileInputRef.current?.click(); setOpenMenuOpen(false) }} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors">
                <IconUpload /><span>{t('tool.openFile')}</span>
              </button>
              <button onClick={() => { onOpenUrl(); setOpenMenuOpen(false) }} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors">
                <IconLink /><span>{t('tool.openUrl')}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {printButton}
      {passwordButton}
      {speakButton}
      {ocrCluster}

      {/* Export — split button: main downloads PDF, chevron opens the format menu. */}
      {hasPdf && !embed && (
        <div ref={exportRef} className="relative flex items-stretch">
          <button
            onClick={onExportPdf}
            disabled={isExporting}
            className="flex items-center justify-center w-9 h-9 rounded-l bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-all"
            title={isExporting ? t('tool.exporting') : t('tool.exportPdf')}
            aria-label={t('tool.exportPdf')}
          ><IconDownload /></button>
          <button
            onClick={() => setExportMenuOpen(v => !v)}
            disabled={isExporting}
            aria-expanded={exportMenuOpen}
            aria-label={t('tool.export')}
            title={t('tool.exportMore')}
            className="flex items-center justify-center h-9 px-1 rounded-r bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 border-l border-blue-400/40 transition-all"
          ><IconChevron /></button>
          {exportMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50 min-w-[175px]">
              {exportMenuItems(() => setExportMenuOpen(false))}
            </div>
          )}
        </div>
      )}
    </div>
  )

  // ── Collapsed (hamburger) sections ─────────────────────────────────────────
  const menuItem = 'w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors rounded'

  const collapsedLeft = (
    <div ref={leftMenuRef} className="relative flex items-center px-2 py-1.5">
      {(hasPdf || flowDoc) ? (
        <>
          <button
            onClick={() => setLeftMenuOpen(v => !v)}
            aria-expanded={leftMenuOpen}
            className={`${BTN_BASE} ${leftMenuOpen ? BTN_ACTIVE : BTN_IDLE}`}
            title={t('tool.menuLeft')}
            aria-label={t('tool.menuLeft')}
          ><IconMenu /></button>
          {leftMenuOpen && (
            <div className="absolute left-2 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-2 z-50 flex flex-col gap-2">
              {flowDoc && !isFullscreen && (<>{fullscreenButton}{zoomCluster}</>)}
              {hasPdf && viewCluster}
              {hasPdf && !isFullscreen && viewMode !== 'grid' && zoomCluster}
              {hasPdf && !isFullscreen && (
                <div className="flex items-center gap-0.5">
                  {rotateButton}
                  {pagesButton}
                  {eraserButton}
                </div>
              )}
            </div>
          )}
        </>
      ) : brandingCluster}
    </div>
  )

  // The collapsed bar's middle was empty apart from a page counter floating off
  // to one side. It is the only place a narrow screen has room for the file
  // name, so it carries both — and `flex-1 min-w-0` is what actually centres
  // it between two clusters of unequal width, rather than leaving it wherever
  // `justify-between` happens to put it.
  const collapsedCenter = (
    <div className="flex flex-1 min-w-0 items-center justify-center gap-1.5 px-1">
      {fileName && (
        <span className="truncate text-xs text-gray-400 min-w-0">{fileName}</span>
      )}
      {hasPdf && !isFullscreen && (
        <span className="shrink-0 text-xs text-gray-500 tabular-nums">
          {currentPage} / {numPages}
        </span>
      )}
    </div>
  )

  const collapsedRight = (
    <div ref={rightMenuRef} className="relative flex items-center px-2 py-1.5 border-l border-gray-700/40">
      <button
        onClick={() => setRightMenuOpen(v => !v)}
        aria-expanded={rightMenuOpen}
        className={`${BTN_BASE} ${rightMenuOpen ? BTN_ACTIVE : BTN_IDLE}`}
        title={t('tool.menuRight')}
        aria-label={t('tool.menuRight')}
      ><IconMore /></button>
      {rightMenuOpen && (
        <div className="absolute right-2 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50 min-w-[190px]">
          {!embed && (
            <>
              {/* Same lock switch, as a labelled row inside the dropdown. */}
              <button
                role="switch"
                aria-checked={appMode === 'editor'}
                onClick={() => onAppModeChange(appMode === 'editor' ? 'viewer' : 'editor')}
                className={menuItem}
              >
                <IconPencil />
                <span className="flex-1 text-left">{t('tool.editLock')}</span>
                <span className={`text-[10px] font-semibold ${appMode === 'editor' ? 'text-amber-300' : 'text-gray-500'}`}>
                  {appMode === 'editor' ? 'ON' : 'OFF'}
                </span>
              </button>
              {hasPdf && (
                <button onClick={() => { onPassword(); setRightMenuOpen(false) }} className={menuItem} disabled={isExporting}>
                  {saveLocked ? <IconLock /> : <IconLockOpen />}
                  <span className="flex-1 text-left">
                    {saveLocked ? t('tool.passwordRemove') : t('tool.passwordSet')}
                  </span>
                </button>
              )}
              <div className="my-1 border-t border-gray-600" />
              <button onClick={() => { fileInputRef.current?.click(); setRightMenuOpen(false) }} className={menuItem}><IconUpload /><span>{t('tool.openFile')}</span></button>
              <button onClick={() => { onOpenUrl(); setRightMenuOpen(false) }} className={menuItem}><IconLink /><span>{t('tool.openUrl')}</span></button>
            </>
          )}
          {onToggleSpeech && (hasPdf || flowDoc) && (
            <button
              onClick={() => { onToggleSpeech(); setRightMenuOpen(false) }}
              className={menuItem}
            >
              {isSpeaking ? <IconStopSpeak /> : <IconSpeak />}
              <span>{isSpeaking ? t('tts.stop') : t('tts.read')}</span>
            </button>
          )}
          {hasPdf && (
            <>
              <button onClick={() => { onPrint(); setRightMenuOpen(false) }} className={menuItem}><IconPrint /><span>{t('tool.print')}</span></button>
              <button onClick={() => { onRunOcr(); setRightMenuOpen(false) }} disabled={isOcrRunning || numPages === 0} className={`${menuItem} disabled:opacity-40`}><IconOcr /><span>{t('ocr.runCurrent')}</span></button>
              <button onClick={() => { onRunOcrAll(); setRightMenuOpen(false) }} disabled={isOcrRunning || numPages === 0} className={`${menuItem} disabled:opacity-40`}><IconOcr /><span>{t('ocr.runAll')}</span></button>
            </>
          )}
          {hasPdf && !embed && (
            <>
              <div className="my-1 border-t border-gray-600" />
              {exportMenuItems(() => setRightMenuOpen(false))}
            </>
          )}
        </div>
      )}
    </div>
  )

  // The document's name, centred in the bar the way a title bar names its
  // window. Absolutely positioned so it is centred on the *bar*, not on
  // whatever space the two clusters happen to leave; `pointer-events-none`
  // keeps it out of the way of the window drag region in the desktop build.
  // Hidden on narrow screens, where the clusters reach the middle.
  const titleCentre = fileName ? (
    <div
      ref={titleRef}
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      aria-hidden
      // Width and visibility are set imperatively by the effect below, which is
      // the only thing that knows how much room the two clusters have left.
      style={{ visibility: 'hidden' }}
    >
      <span className="truncate text-xs text-gray-400">{fileName}</span>
    </div>
  ) : null

  // Editing tools get their own row rather than more of the main bar. They are
  // a different job — the bar above navigates the document, this one changes
  // it — and folding them in was also what pushed the bar into its collapsed
  // layout as soon as the padlock was opened.
  const editorRow = (hasPdf && appMode === 'editor' && !isFullscreen) ? (
    <div className="no-print flex items-center gap-0.5 shrink-0 overflow-x-auto
                    bg-gray-800/80 border-b border-gray-700 px-2 py-1">
      <span className="hidden sm:inline shrink-0 pr-1.5 text-[11px] font-medium text-amber-300/80">
        {t('tool.editTools')}
      </span>
      {editorCluster}
      {/* The markup eraser deliberately stays in the main bar: pen and rectangle
          can be drawn in viewer mode too (keys 1 and 2), so clearing them is not
          an editing-mode action. */}
    </div>
  ) : null

  return (
    <>
      {/* ── Toolbar ───────────────────────────────────────────────────────────
          Two clusters justified to the edges, with the file name centred
          between them. When the inline controls no longer fit (narrow window)
          `useToolbarCollapse` folds each cluster into a hamburger menu instead
          of showing a horizontal scrollbar. */}
      <header
        ref={headerRef}
        className="flex items-stretch justify-between bg-gray-900 text-white shadow-md z-10 shrink-0 border-b border-gray-700 relative"
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
      >
        {!collapsed && titleCentre}
        {collapsed ? (
          <>
            {collapsedLeft}
            {collapsedCenter}
            {collapsedRight}
          </>
        ) : (
          <>
            {expandedLeft}
            {expandedRight}
          </>
        )}
      </header>

      {editorRow}

      <input ref={fileInputRef} type="file" accept={DOCUMENT_ACCEPT} className="hidden" onChange={handleFileChange} />

      {/* Stamp dropdown portal — rendered in <body> to escape toolbar overflow */}
      {stampPortal}
    </>
  )
}
