import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { AppMode, ViewMode } from '../../types/viewModes'
import type { ActiveMode } from '../../types/annotation'
import { STAMP_PRESETS, svgToPng } from '../../utils/stampPresets'
import { t } from '../../i18n'

// ── SVG Icon components ────────────────────────────────────────────────────
const IconSingle = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <rect x="5" y="3" width="10" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
  </svg>
)
const IconSpread = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <rect x="1" y="3" width="8" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <rect x="11" y="3" width="8" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
  </svg>
)
const IconGrid = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <rect x="2" y="2" width="6" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <rect x="12" y="2" width="6" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <rect x="2" y="11" width="6" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <rect x="12" y="11" width="6" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
  </svg>
)
const IconFullscreen = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/>
  </svg>
)
const IconRotate = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M4 10a6 6 0 0 1 10.5-4H12" strokeLinecap="round"/>
    <path d="M14.5 6l1.5-2.5L13.5 2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M16 10a6 6 0 0 1-10.5 4H8" strokeLinecap="round"/>
    <path d="M5.5 14l-1.5 2.5L6.5 18" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IconZoomOut = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
    <circle cx="9" cy="9" r="6"/>
    <path d="M6.5 9h5M15 15l2.5 2.5" strokeLinecap="round"/>
  </svg>
)
const IconZoomIn = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
    <circle cx="9" cy="9" r="6"/>
    <path d="M9 6.5v5M6.5 9h5M15 15l2.5 2.5" strokeLinecap="round"/>
  </svg>
)
const IconSelect = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path d="M4 2l12 8-6.5 1.5L7 18 4 2z"/>
  </svg>
)
const IconStamp = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <rect x="4" y="13" width="12" height="4" rx="1"/>
    <path d="M7 13V8a3 3 0 0 1 6 0v5"/>
  </svg>
)
const IconSignature = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M3 15c2-4 4-8 5-10 .5-1 2-1 2 0s-1 3-1 5c0 2 3-2 4-3" strokeLinecap="round"/>
    <path d="M3 17h14" strokeLinecap="round"/>
  </svg>
)
const IconWatermark = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4" opacity="0.85">
    <rect x="2" y="2" width="16" height="16" rx="1"/>
    <text x="5" y="14" fontSize="9" fill="currentColor" stroke="none" opacity="0.7" fontWeight="bold">W</text>
  </svg>
)
const IconDelete = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M5 6h10l-1 11H6L5 6zM3 6h14M8 6V4h4v2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IconUpload = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M10 13V5M7 8l3-3 3 3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4 15h12" strokeLinecap="round"/>
  </svg>
)
const IconLink = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M8 11a3 3 0 004.24 0l2.5-2.5a3 3 0 00-4.24-4.24L11 5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 9a3 3 0 00-4.24 0l-2.5 2.5a3 3 0 004.24 4.24L9 15" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IconDownload = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M10 5v8M7 10l3 3 3-3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4 15h12" strokeLinecap="round"/>
  </svg>
)
const IconHtml = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M5 7l-3 3 3 3M15 7l3 3-3 3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 4l-4 12" strokeLinecap="round"/>
  </svg>
)
const IconImage = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <rect x="2" y="4" width="16" height="12" rx="1.5"/>
    <circle cx="7" cy="8.5" r="1.5"/>
    <path d="M2 14l4-4 3 3 3-3 6 5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IconChevron = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
    <path d="M5 7l5 5 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IconPrint = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <rect x="4" y="8" width="12" height="8" rx="1"/>
    <path d="M6 8V4h8v4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M6 12h8M6 14.5h5" strokeLinecap="round"/>
    <circle cx="15" cy="11" r="0.8" fill="currentColor" stroke="none"/>
  </svg>
)
const IconOcr = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M7 8h6M7 12h10M7 16h8" />
  </svg>
)
// Eraser — distinct from the (similar-looking) view/rotate icons.
const IconReset = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="w-4 h-4">
    <path d="M8.5 16.5l-3.8-3.8a1.5 1.5 0 0 1 0-2.12l6-6a1.5 1.5 0 0 1 2.12 0l3.3 3.3a1.5 1.5 0 0 1 0 2.12L11.5 16.5H8.5z" strokeLinejoin="round"/>
    <path d="M16.5 16.5H8.5" strokeLinecap="round"/>
    <path d="M6.2 8.8l5 5" />
  </svg>
)
const IconExe = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <rect x="3" y="4" width="14" height="12" rx="1.5"/>
    <path d="M7 8h6M7 10.5h4" strokeLinecap="round"/>
    <path d="M13 13l2 2" strokeLinecap="round"/>
    <circle cx="14.5" cy="14.5" r="2.5" fill="currentColor" stroke="none" opacity="0.9"/>
    <path d="M13.8 14.5h1.4M14.5 13.8v1.4" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
)
const IconViewer = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M10 4C5 4 2 10 2 10s3 6 8 6 8-6 8-6-3-6-8-6z"/>
    <circle cx="10" cy="10" r="2.5"/>
  </svg>
)
const IconEditor = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M14 3l3 3-9 9H5v-3L14 3z" strokeLinejoin="round"/>
  </svg>
)

// ── Separator component ────────────────────────────────────────────────────
const Sep = () => <div className="w-px h-5 bg-gray-600 mx-0.5 shrink-0" />

export interface ActionBarProps {
  hasPdf: boolean
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
  const fileInputRef  = useRef<HTMLInputElement>(null)
  const stampBtnRef   = useRef<HTMLButtonElement>(null)
  const stampPortalRef = useRef<HTMLDivElement>(null)
  const exportRef     = useRef<HTMLDivElement>(null)
  const openRef       = useRef<HTMLDivElement>(null)

  // Close stamp menu on outside click (portal is in body, so check both refs)
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

  // Close export menu on outside click
  useEffect(() => {
    if (!exportMenuOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [exportMenuOpen])

  // Close open menu on outside click
  useEffect(() => {
    if (!openMenuOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (openRef.current && !openRef.current.contains(e.target as Node)) {
        setOpenMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [openMenuOpen])

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
    if (!file) return
    const name = file.name.toLowerCase()
    const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf')
    const isHwp = name.endsWith('.hwp') || name.endsWith('.hwpx')
    if (isPdf || isHwp) onUpload(file)
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
  // Single shared icon-only size so every toolbar button hits the same grid.
  // Tooltips (`title` attr) carry the label; visible text is reserved for
  // status (page count, zoom %).
  const BTN_BASE = 'flex items-center justify-center w-9 h-9 rounded transition-all'
  const BTN_IDLE = 'text-gray-300 hover:bg-gray-700 hover:text-white'
  const BTN_ACTIVE = 'bg-blue-600 text-white shadow-sm'

  const viewBtn = (mode: ViewMode) =>
    `${BTN_BASE} ${viewMode === mode ? BTN_ACTIVE : BTN_IDLE}`

  const modeToggleBtn = (mode: AppMode) =>
    `${BTN_BASE} ${appMode === mode ? BTN_ACTIVE : BTN_IDLE}`

  const toolBtn = (mode: ActiveMode) =>
    `${BTN_BASE} ${activeMode === mode ? BTN_ACTIVE : BTN_IDLE}`

  const iconBtn = (_label: string, extra = '') => `${BTN_BASE} ${BTN_IDLE} ${extra}`

  const isFullscreen = viewMode === 'fullscreen'

  // ── Stamp portal menu ─────────────────────────────────────────────────────
  const stampPortal = stampPanelOpen && stampMenuRect
    ? createPortal(
        <div
          ref={stampPortalRef}
          style={{
            position: 'fixed',
            top: stampMenuRect.bottom + 4,
            left: stampMenuRect.left,
            zIndex: 9999,
          }}
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

  return (
    <>
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      {/*                                                                        */}
      {/*  ┌─────────────────────────────────────┬──────────────────────────┐  */}
      {/*  │  LEFT  — overflow-x:auto             │  RIGHT — no overflow    │  */}
      {/*  │  view / zoom / editor tools          │  mode / open / export   │  */}
      {/*  └─────────────────────────────────────┴──────────────────────────┘  */}
      {/*                                                                        */}
      {/*  Keeping the right section out of the overflow container lets         */}
      {/*  the Export dropdown render without being clipped.                    */}
      {/*  The Stamp dropdown (left section) escapes via a React portal.        */}

      <header
        className="flex bg-gray-900 text-white shadow-md z-10 shrink-0 border-b border-gray-700"
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
      >
        {/* ── Left: scrollable view + editor controls ── */}
        <div className="flex items-center gap-1 px-3 py-1.5 flex-1 min-w-0 overflow-x-auto">
          {/* Empty-state branding — only when no PDF is loaded */}
          {!hasPdf && (
            <div className="flex items-center gap-2.5 px-1.5 py-0.5 select-none">
              <img src="./icon.svg" alt="" className="w-7 h-7 rounded-md shrink-0" draggable={false} />
              <span
                className="text-lg font-bold tracking-tight bg-gradient-to-br from-sky-400 to-violet-400 bg-clip-text text-transparent leading-none"
              >
                WZ PDF
              </span>
              <span className="hidden sm:inline text-xs text-gray-500 ml-1">{t('app.tagline')}</span>
              {/* Version pill — injected at build time from package.json via Vite. */}
              <span
                className="ml-1 rounded-full border border-gray-700 px-2 py-px text-[10px] font-medium text-gray-400 tabular-nums"
                title="App version"
              >
                v{__APP_VERSION__}
              </span>
            </div>
          )}

          {hasPdf && (
            <>
              {/* View mode buttons */}
              <div className="flex items-center gap-0.5 shrink-0">
                <button className={viewBtn('single')}     onClick={() => onViewModeChange('single')}     title={t('tool.single')}     aria-label={t('tool.single')}><IconSingle /></button>
                <button className={viewBtn('spread')}     onClick={() => onViewModeChange('spread')}     title={t('tool.spread')}     aria-label={t('tool.spread')}><IconSpread /></button>
                <button className={viewBtn('grid')}       onClick={() => onViewModeChange('grid')}       title={t('tool.grid')}       aria-label={t('tool.grid')}><IconGrid /></button>
                <button className={viewBtn('fullscreen')} onClick={() => onViewModeChange('fullscreen')} title={t('tool.fullscreen')} aria-label={t('tool.fullscreen')}><IconFullscreen /></button>
              </div>

              <Sep />

              {/* Page counter */}
              {!isFullscreen && (
                <span className="text-xs text-gray-400 tabular-nums shrink-0 px-1 min-w-[56px] text-center">
                  {currentPage} / {numPages}
                </span>
              )}

              {/* Zoom — hidden in fullscreen & grid */}
              {!isFullscreen && viewMode !== 'grid' && (
                <>
                  <Sep />
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button onClick={onZoomOut}   className={iconBtn('Zoom out')} title={t('tool.zoomOut')} aria-label={t('tool.zoomOut')}><IconZoomOut /></button>
                    <button onClick={onZoomReset} className="text-xs text-gray-300 hover:text-white w-12 text-center tabular-nums" title={t('tool.zoomReset')} aria-label={t('tool.zoomReset')}>
                      {Math.round(zoom * 100)}%
                    </button>
                    <button onClick={onZoomIn} className={iconBtn('Zoom in')} title={t('tool.zoomIn')} aria-label={t('tool.zoomIn')}><IconZoomIn /></button>
                  </div>
                </>
              )}

              {/* Rotate */}
              {!isFullscreen && (
                <>
                  <Sep />
                  <button
                    onClick={onRotate}
                    className={`${iconBtn('Rotate 90°')} ${rotation !== 0 ? 'text-blue-400' : ''}`}
                    title={t('tool.rotate', { deg: rotation })}
                    aria-label={t('tool.rotate', { deg: rotation })}
                  >
                    <IconRotate />
                  </button>
                </>
              )}

              {/* Pages 패널 토글 — viewer/editor 양쪽 모드에서 사용 가능 */}
              {!isFullscreen && (
                <>
                  <Sep />
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

                  {/* Eraser — only shown once pen/rectangle markup exists. */}
                  {hasMarkups && (
                    <button
                      className={iconBtn('Reset markups')}
                      onClick={onResetMarkups}
                      title={t('tool.reset')}
                      aria-label={t('tool.reset')}
                    >
                      <IconReset />
                    </button>
                  )}
                </>
              )}

              {/* Editor annotation tools */}
              {appMode === 'editor' && !isFullscreen && (
                <>
                  <Sep />
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      className={toolBtn('select')}
                      onClick={() => { onModeChange('select'); setStampPanelOpen(false) }}
                      title={t('tool.select')}
                      aria-label={t('tool.select')}
                    ><IconSelect /></button>

                    {/* Stamp button — dropdown rendered via portal (escapes overflow) */}
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
                </>
              )}
            </>
          )}
        </div>

        {/* ── Right: fixed controls (not inside overflow — dropdown safe) ── */}
        <div className="flex items-center gap-1 px-2 sm:px-3 py-1.5 shrink-0 border-l border-gray-700/40">
          {/* Viewer / Editor mode toggle (icon-only segmented control).
              Hidden in embed mode — an embedded viewer is read-only. */}
          {!embed && (
            <>
              <div className="flex items-center bg-gray-800 rounded-lg p-0.5 border border-gray-700">
                <button
                  className={modeToggleBtn('viewer')}
                  onClick={() => onAppModeChange('viewer')}
                  title={t('tool.viewer')}
                  aria-label={t('tool.viewer')}
                ><IconViewer /></button>
                <button
                  className={modeToggleBtn('editor')}
                  onClick={() => onAppModeChange('editor')}
                  title={t('tool.editor')}
                  aria-label={t('tool.editor')}
                ><IconEditor /></button>
              </div>

              <Sep />
            </>
          )}

          {/* Open dropdown — file or URL. Hidden in embed mode. */}
          {!embed && (
          <div ref={openRef} className="relative">
            <button
              onClick={() => setOpenMenuOpen(v => !v)}
              aria-expanded={openMenuOpen}
              className={`${BTN_BASE} bg-gray-700 hover:bg-gray-600 text-gray-100`}
              title={t('tool.open')}
              aria-label={t('tool.open')}
            ><IconUpload /></button>
            {openMenuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50 min-w-[170px]">
                <button
                  onClick={() => { fileInputRef.current?.click(); setOpenMenuOpen(false) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors"
                >
                  <IconUpload /><span>{t('tool.openFile')}</span>
                </button>
                <button
                  onClick={() => { onOpenUrl(); setOpenMenuOpen(false) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors"
                >
                  <IconLink /><span>{t('tool.openUrl')}</span>
                </button>
              </div>
            )}
          </div>
          )}
          <input ref={fileInputRef} type="file" accept="application/pdf,.pdf,.hwp,.hwpx" className="hidden" onChange={handleFileChange} />

          {/* Print */}
          {hasPdf && (
            <button
              onClick={onPrint}
              className={`${BTN_BASE} bg-gray-700 hover:bg-gray-600 text-gray-100`}
              title={t('tool.print')}
              aria-label={t('tool.print')}
            ><IconPrint /></button>
          )}

          {/* OCR — visible for any loaded PDF, both viewer and editor modes */}
          {hasPdf && (
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
                <span className="ml-1 text-[10px] text-gray-400 tabular-nums">
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
          )}

          {/* Export dropdown — absolute child renders below this section, no overflow parent.
              Hidden in embed mode (read-only viewer). */}
          {hasPdf && !embed && (
            <div ref={exportRef} className="relative">
              <button
                onClick={() => setExportMenuOpen(v => !v)}
                disabled={isExporting}
                aria-expanded={exportMenuOpen}
                aria-label={t('tool.export')}
                className={`${BTN_BASE} bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 w-auto px-2.5 gap-1`}
                title={isExporting ? t('tool.exporting') : t('tool.export')}
              >
                <IconDownload />
                <IconChevron />
              </button>

              {exportMenuOpen && (
                <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50 min-w-[175px]">
                  <button
                    onClick={() => { onExportPdf(); setExportMenuOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors"
                  >
                    <IconDownload /><span>{t('export.pdf')}</span>
                    <span className="ml-auto text-gray-500 text-[10px]">.pdf</span>
                  </button>

                  <button
                    onClick={() => { onExportHtml(); setExportMenuOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors"
                  >
                    <IconHtml /><span>{t('export.html')}</span>
                    <span className="ml-auto text-gray-500 text-[10px]">.html</span>
                  </button>

                  <button
                    onClick={() => { onExportImages(); setExportMenuOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors"
                  >
                    <IconImage /><span>{t('export.images')}</span>
                    <span className="ml-auto text-gray-500 text-[10px]">.zip</span>
                  </button>

                  {onExportExe && (
                    <>
                      <div className="my-1 border-t border-gray-600" />
                      <button
                        onClick={() => { onExportExe(); setExportMenuOpen(false) }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-emerald-300 hover:bg-gray-700 transition-colors"
                      >
                        <IconExe /><span>{t('export.exe')}</span>
                        <span className="ml-auto text-gray-500 text-[10px]">.exe</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Stamp dropdown portal — rendered in <body> to escape toolbar overflow */}
      {stampPortal}
    </>
  )
}
