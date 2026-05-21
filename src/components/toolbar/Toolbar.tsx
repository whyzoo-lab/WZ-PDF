import React, { useState } from 'react'
import type { ActiveMode } from '../../types/annotation'
import { STAMP_PRESETS, svgToPng } from '../../utils/stampPresets'
import { ZoomControls } from '../viewer/ZoomControls'

interface ToolbarProps {
  activeMode: ActiveMode
  selectedId: string | null
  zoom: number
  hasPdf: boolean
  onModeChange: (mode: ActiveMode) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onDeleteSelected: () => void
  onStampSelect: (src: string, presetId?: string) => void
  onSignatureClick: () => void
  onWatermarkClick: () => void
}

export function Toolbar({
  activeMode,
  selectedId,
  zoom,
  hasPdf,
  onModeChange,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onDeleteSelected,
  onStampSelect,
  onSignatureClick,
  onWatermarkClick,
}: ToolbarProps) {
  const [stampPanelOpen, setStampPanelOpen] = useState(false)

  const handlePresetClick = async (presetId: string, svg: string) => {
    const pngDataUrl = await svgToPng(svg)
    onStampSelect(pngDataUrl, presetId)
    setStampPanelOpen(false)
    onModeChange('stamp')
  }

  const handleCustomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const src = ev.target?.result as string
      onStampSelect(src)
      setStampPanelOpen(false)
      onModeChange('stamp')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const btn = (mode: ActiveMode | 'stamp-toggle') =>
    `w-full py-2 px-2 text-xs sm:text-sm rounded text-left transition-colors ${
      activeMode === mode
        ? 'bg-blue-600 text-white'
        : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
    }`

  return (
    <aside className="flex flex-col w-12 sm:w-36 bg-gray-800 text-white py-3 px-1 sm:px-2 gap-1 shrink-0">
      {hasPdf && (
        <>
          <button className={btn('select')} onClick={() => { onModeChange('select'); setStampPanelOpen(false) }}>
            <span className="sm:hidden">↖</span>
            <span className="hidden sm:inline">Select</span>
          </button>

          <button
            className={`${btn('stamp')} ${activeMode === 'stamp' ? 'bg-blue-600' : ''}`}
            onClick={() => setStampPanelOpen(v => !v)}
          >
            <span className="sm:hidden">🔖</span>
            <span className="hidden sm:inline">Stamp</span>
          </button>

          {stampPanelOpen && (
            <div className="bg-gray-700 rounded p-1 flex flex-col gap-0.5">
              {STAMP_PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => handlePresetClick(p.id, p.svg)}
                  className="text-xs text-left px-2 py-1.5 hover:bg-gray-600 rounded"
                >
                  {p.label}
                </button>
              ))}
              <label className="text-xs text-left px-2 py-1.5 hover:bg-gray-600 rounded cursor-pointer">
                Upload PNG…
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={handleCustomUpload}
                />
              </label>
            </div>
          )}

          <button
            className={btn('signature')}
            onClick={() => { onModeChange('signature'); onSignatureClick(); setStampPanelOpen(false) }}
          >
            <span className="sm:hidden">✍</span>
            <span className="hidden sm:inline">Signature</span>
          </button>

          <button
            className={btn('watermark')}
            onClick={() => { onModeChange('watermark'); onWatermarkClick(); setStampPanelOpen(false) }}
          >
            <span className="sm:hidden">💧</span>
            <span className="hidden sm:inline">Watermark</span>
          </button>

          {selectedId && (
            <button
              onClick={onDeleteSelected}
              className="w-full py-2 px-2 text-xs sm:text-sm rounded text-left bg-red-700 hover:bg-red-600 text-white mt-2 transition-colors"
            >
              <span className="sm:hidden">🗑</span>
              <span className="hidden sm:inline">Delete</span>
            </button>
          )}
        </>
      )}

      <ZoomControls zoom={zoom} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onZoomReset={onZoomReset} />
    </aside>
  )
}
