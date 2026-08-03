import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { AppMode, ViewMode } from '../../types/viewModes'
import type { ActiveMode } from '../../types/annotation'
import { STAMP_PRESETS, svgToPng } from '../../utils/stampPresets'
import { classifyDocFile } from '../../utils/detectDocType'
import { t } from '../../i18n'
import {
  IconSingle, IconSpread, IconGrid, IconFullscreen, IconRotate, IconSelect,
  IconStamp, IconSignature, IconWatermark, IconDelete, IconUpload, IconLink,
  IconDownload, IconHtml, IconImage, IconChevron, IconPrint, IconOcr, IconReset,
  IconExe, IconLock, IconLockOpen, IconMenu, IconMore,
} from './icons'
import { Sep, BTN_BASE, BTN_IDLE, BTN_ACTIVE, BTN_ARMED } from './toolbarStyles'
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
  onRotate: () => void
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
  onExportHtml: () => void
  onExportImages: () => void
  /** If undefined, the EXE option is hidden (only available in Electron builds). */
  onExportExe?: () => void
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
  onRotate,
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
  onExportHtml,
  onExportImages,
  onExportExe,
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
    <ZoomControl zoom={zoom} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onZoomSet={onZoomSet} onZoomReset={onZoomReset} />
  )

  const rotateButton = (
    <button
      onClick={onRotate}
      className={`${iconBtn()} ${rotation !== 0 ? 'text-blue-400' : ''}`}
      title={t('tool.rotate', { deg: rotation })}
      aria-label={t('tool.rotate', { deg: rotation })}
    ><IconRotate /></button>
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
  // Editing is a lock, not a pair of destinations: locked = read-only viewer,
  // unlocked = editing tools appear. One round ghost button, like every other
  // control in the bar — `role="switch"` gives it real on/off semantics.
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
      {appMode === 'editor' ? <IconLockOpen /> : <IconLock />}
    </button>
  ) : null

  const printButton = (hasPdf || flowDoc) ? (
    <button
      onClick={onPrint}
      className={`${BTN_BASE} bg-gray-700 hover:bg-gray-600 text-gray-100`}
      title={t('tool.print')}
      aria-label={t('tool.print')}
    ><IconPrint /></button>
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
      {ocrProgress && (
        <span className="ml-1 text-[10px] text-gray-400 tabular-nums">{ocrProgress.done}/{ocrProgress.total}</span>
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
    <div className="flex items-center gap-1 px-3 py-1.5 min-w-0 shrink-0">
      {!hasPdf && brandingCluster}
      {flowDoc && !isFullscreen && (<><Sep />{fullscreenButton}<Sep />{zoomCluster}</>)}
      {hasPdf && (
        <>
          {viewCluster}
          {!isFullscreen && (<><Sep />{pageCounter}</>)}
          {!isFullscreen && viewMode !== 'grid' && (<><Sep />{zoomCluster}</>)}
          {!isFullscreen && (<><Sep />{rotateButton}</>)}
          {!isFullscreen && (<><Sep />{pagesButton}{eraserButton}</>)}
          {appMode === 'editor' && !isFullscreen && (<><Sep />{editorCluster}</>)}
        </>
      )}
    </div>
  )

  const expandedRight = (
    <div className="flex items-center gap-1 px-2 sm:px-3 py-1.5 shrink-0 border-l border-gray-700/40">
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
              {hasPdf && appMode === 'editor' && !isFullscreen && editorCluster}
            </div>
          )}
        </>
      ) : brandingCluster}
    </div>
  )

  const collapsedCenter = hasPdf && !isFullscreen ? pageCounter : <span />

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
                {appMode === 'editor' ? <IconLockOpen /> : <IconLock />}
                <span className="flex-1 text-left">{t('tool.editLock')}</span>
                <span className={`text-[10px] font-semibold ${appMode === 'editor' ? 'text-amber-300' : 'text-gray-500'}`}>
                  {appMode === 'editor' ? 'ON' : 'OFF'}
                </span>
              </button>
              <div className="my-1 border-t border-gray-600" />
              <button onClick={() => { fileInputRef.current?.click(); setRightMenuOpen(false) }} className={menuItem}><IconUpload /><span>{t('tool.openFile')}</span></button>
              <button onClick={() => { onOpenUrl(); setRightMenuOpen(false) }} className={menuItem}><IconLink /><span>{t('tool.openUrl')}</span></button>
            </>
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

  return (
    <>
      {/* ── Toolbar ───────────────────────────────────────────────────────────
          Two clusters justified to the edges. When the inline controls no
          longer fit (narrow window) `useToolbarCollapse` folds each cluster
          into a hamburger menu instead of showing a horizontal scrollbar. */}
      <header
        ref={headerRef}
        className="flex items-stretch justify-between bg-gray-900 text-white shadow-md z-10 shrink-0 border-b border-gray-700 relative"
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
      >
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

      <input ref={fileInputRef} type="file" accept="application/pdf,.pdf,.hwp,.hwpx" className="hidden" onChange={handleFileChange} />

      {/* Stamp dropdown portal — rendered in <body> to escape toolbar overflow */}
      {stampPortal}
    </>
  )
}
