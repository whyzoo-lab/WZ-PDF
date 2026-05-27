import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { AppMode, ViewMode } from '../../types/viewModes'
import type { ActiveMode } from '../../types/annotation'
import { STAMP_PRESETS, svgToPng } from '../../utils/stampPresets'

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
  // ── Export menu ────────────────────────────────────────────────────────────
  onExportPdf: () => void
  onExportHtml: () => void
  onExportImages: () => void
  /** If undefined, the EXE option is hidden (only available in Electron builds). */
  onExportExe?: () => void
}

export function ActionBar({
  hasPdf,
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
  onExportPdf,
  onExportHtml,
  onExportImages,
  onExportExe,
}: ActionBarProps) {
  const [stampPanelOpen, setStampPanelOpen] = useState(false)
  const [stampMenuRect, setStampMenuRect] = useState<DOMRect | null>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const fileInputRef  = useRef<HTMLInputElement>(null)
  const stampBtnRef   = useRef<HTMLButtonElement>(null)
  const stampPortalRef = useRef<HTMLDivElement>(null)
  const exportRef     = useRef<HTMLDivElement>(null)

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
    if (file?.type === 'application/pdf') onUpload(file)
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
    `flex items-center justify-center w-8 h-8 rounded transition-all ${
      viewMode === mode
        ? 'bg-blue-600 text-white shadow-sm'
        : 'text-gray-300 hover:bg-gray-700 hover:text-white'
    }`

  const modeToggleBtn = (mode: AppMode) =>
    `flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-all ${
      appMode === mode
        ? 'bg-blue-600 text-white'
        : 'text-gray-300 hover:bg-gray-700 hover:text-white'
    }`

  const toolBtn = (mode: ActiveMode) =>
    `flex items-center gap-1 px-2 py-1.5 text-xs rounded transition-all ${
      activeMode === mode
        ? 'bg-blue-600 text-white shadow-sm'
        : 'text-gray-300 hover:bg-gray-700 hover:text-white'
    }`

  const iconBtn = (_label: string, extra = '') =>
    `flex items-center justify-center w-8 h-8 rounded text-gray-300 hover:bg-gray-700 hover:text-white transition-all ${extra}`

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
            Upload image…
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
          {hasPdf && (
            <>
              {/* View mode buttons */}
              <div className="flex items-center gap-0.5 shrink-0">
                <button className={viewBtn('single')}     onClick={() => onViewModeChange('single')}     title="Single page">    <IconSingle /></button>
                <button className={viewBtn('spread')}     onClick={() => onViewModeChange('spread')}     title="Spread (2 pages)"><IconSpread /></button>
                <button className={viewBtn('grid')}       onClick={() => onViewModeChange('grid')}       title="Grid view">      <IconGrid /></button>
                <button className={viewBtn('fullscreen')} onClick={() => onViewModeChange('fullscreen')} title="Fullscreen (F5)"><IconFullscreen /></button>
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
                    <button onClick={onZoomOut}   className={iconBtn('Zoom out')} title="Zoom out"><IconZoomOut /></button>
                    <button onClick={onZoomReset} className="text-xs text-gray-300 hover:text-white w-12 text-center tabular-nums" title="Reset zoom" aria-label="Reset zoom">
                      {Math.round(zoom * 100)}%
                    </button>
                    <button onClick={onZoomIn} className={iconBtn('Zoom in')} title="Zoom in"><IconZoomIn /></button>
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
                    title={`Rotate 90° (current: ${rotation}°)`}
                  >
                    <IconRotate />
                  </button>
                </>
              )}

              {/* Editor annotation tools */}
              {appMode === 'editor' && !isFullscreen && (
                <>
                  <Sep />
                  <div className="flex items-center gap-0.5 shrink-0">
                    {/* Pages パネル トグル */}
                    <button
                      className={`flex items-center gap-1 px-2 py-1.5 text-xs rounded transition-all ${
                        isPanelOpen
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                      }`}
                      onClick={onTogglePanel}
                      title="페이지 패널 열기/닫기"
                    >
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4">
                        <rect x="2" y="3" width="7" height="14" rx="1"/>
                        <path d="M13 6h4M13 10h4M13 14h4" strokeLinecap="round"/>
                      </svg>
                      <span>Pages</span>
                    </button>

                    <Sep />

                    <button className={toolBtn('select')} onClick={() => { onModeChange('select'); setStampPanelOpen(false) }} title="Select">
                      <IconSelect /> <span>Select</span>
                    </button>

                    {/* Stamp button — dropdown rendered via portal (escapes overflow) */}
                    <button
                      ref={stampBtnRef}
                      className={toolBtn('stamp')}
                      onClick={openStampMenu}
                      title="Stamp"
                      aria-expanded={stampPanelOpen}
                    >
                      <IconStamp /> <span>Stamp ▾</span>
                    </button>

                    <button
                      className={toolBtn('signature')}
                      onClick={() => { onModeChange('signature'); onSignatureClick(); setStampPanelOpen(false) }}
                      title="Signature"
                      aria-label="Signature"
                    >
                      <IconSignature /> <span>Sign</span>
                    </button>

                    <button
                      className={toolBtn('watermark')}
                      onClick={() => { onModeChange('watermark'); onWatermarkClick(); setStampPanelOpen(false) }}
                      title="Watermark"
                      aria-label="Watermark"
                    >
                      <IconWatermark /> <span>W Mark</span>
                    </button>

                    {selectedId && (
                      <button
                        onClick={onDeleteSelected}
                        className="flex items-center gap-1 px-2 py-1.5 text-xs rounded bg-red-700 hover:bg-red-600 text-white transition-all"
                        title="Delete selected"
                      >
                        <IconDelete /> <span>Delete</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* ── Right: fixed controls (not inside overflow — dropdown safe) ── */}
        <div className="flex items-center gap-1 px-3 py-1.5 shrink-0 border-l border-gray-700/40">
          {/* Viewer / Editor mode toggle */}
          <div className="flex items-center bg-gray-800 rounded-lg p-0.5 border border-gray-700">
            <button className={modeToggleBtn('viewer')} onClick={() => onAppModeChange('viewer')} title="Viewer mode">
              <IconViewer /> Viewer
            </button>
            <button className={modeToggleBtn('editor')} onClick={() => onAppModeChange('editor')} title="Editor mode">
              <IconEditor /> Editor
            </button>
          </div>

          <Sep />

          {/* Open */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-700 hover:bg-gray-600 rounded-lg transition-all text-gray-200"
            title="Open PDF (F2)"
          >
            <IconUpload /> Open
          </button>
          <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleFileChange} />

          {/* Print */}
          {hasPdf && (
            <button
              onClick={onPrint}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-700 hover:bg-gray-600 rounded-lg transition-all text-gray-200"
              title="Print (Ctrl+P)"
            >
              <IconPrint /> Print
            </button>
          )}

          {/* Export dropdown — absolute child renders below this section, no overflow parent */}
          {hasPdf && (
            <div ref={exportRef} className="relative">
              <button
                onClick={() => setExportMenuOpen(v => !v)}
                disabled={isExporting}
                aria-expanded={exportMenuOpen}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 rounded-lg transition-all disabled:opacity-50 text-white"
                title="내보내기"
              >
                <IconDownload />
                {isExporting ? '내보내는 중…' : 'Export'}
                <IconChevron />
              </button>

              {exportMenuOpen && (
                <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50 min-w-[175px]">
                  <button
                    onClick={() => { onExportPdf(); setExportMenuOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors"
                  >
                    <IconDownload /><span>PDF 저장</span>
                    <span className="ml-auto text-gray-500 text-[10px]">.pdf</span>
                  </button>

                  <button
                    onClick={() => { onExportHtml(); setExportMenuOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors"
                  >
                    <IconHtml /><span>HTML Viewer</span>
                    <span className="ml-auto text-gray-500 text-[10px]">.html</span>
                  </button>

                  <button
                    onClick={() => { onExportImages(); setExportMenuOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors"
                  >
                    <IconImage /><span>이미지 저장</span>
                    <span className="ml-auto text-gray-500 text-[10px]">.zip</span>
                  </button>

                  {onExportExe && (
                    <>
                      <div className="my-1 border-t border-gray-600" />
                      <button
                        onClick={() => { onExportExe(); setExportMenuOpen(false) }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-emerald-300 hover:bg-gray-700 transition-colors"
                      >
                        <IconExe /><span>EXE Viewer</span>
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
