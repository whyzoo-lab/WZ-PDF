import React, { useRef } from 'react'
import type { AppMode, ViewMode } from '../../types/viewModes'

interface ActionBarProps {
  hasPdf: boolean
  appMode: AppMode
  viewMode: ViewMode
  onUpload: (file: File) => void
  onExport: () => void
  isExporting: boolean
  onAppModeChange: (mode: AppMode) => void
  onViewModeChange: (mode: ViewMode) => void
}

export function ActionBar({
  hasPdf,
  appMode,
  viewMode,
  onUpload,
  onExport,
  isExporting,
  onAppModeChange,
  onViewModeChange,
}: ActionBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

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

  const viewBtn = (mode: ViewMode) =>
    `px-2 py-1 text-sm rounded transition-colors ${
      viewMode === mode
        ? 'bg-blue-600 text-white'
        : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
    }`

  const modeBtn = (mode: AppMode) =>
    `px-3 py-1 text-sm transition-colors ${
      appMode === mode
        ? 'bg-blue-600 text-white'
        : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
    }`

  return (
    <header
      className="flex items-center justify-between px-4 py-2 bg-gray-900 text-white shadow-md z-10 shrink-0"
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
    >
      <span className="font-semibold text-sm tracking-wide">PDF Editor</span>

      <div className="flex gap-2 items-center">
        {/* View mode buttons — only when a PDF is loaded */}
        {hasPdf && (
          <div className="flex gap-1">
            <button
              className={viewBtn('single')}
              onClick={() => onViewModeChange('single')}
              aria-label="Single page view"
              title="Single page"
            >
              ⊟
            </button>
            <button
              className={viewBtn('spread')}
              onClick={() => onViewModeChange('spread')}
              aria-label="Spread view"
              title="Spread"
            >
              ⊞
            </button>
            <button
              className={viewBtn('grid')}
              onClick={() => onViewModeChange('grid')}
              aria-label="Grid view"
              title="Grid"
            >
              ▦
            </button>
            <button
              className={viewBtn('fullscreen')}
              onClick={() => onViewModeChange('fullscreen')}
              aria-label="Fullscreen view"
              title="Fullscreen"
            >
              ⛶
            </button>
          </div>
        )}

        {/* Viewer / Editor toggle */}
        <div className="flex border border-gray-600 rounded overflow-hidden">
          <button
            className={modeBtn('viewer')}
            onClick={() => onAppModeChange('viewer')}
            aria-label="Viewer"
          >
            Viewer
          </button>
          <button
            className={modeBtn('editor')}
            onClick={() => onAppModeChange('editor')}
            aria-label="Editor"
          >
            Editor
          </button>
        </div>

        {/* Upload */}
        <button
          onClick={() => inputRef.current?.click()}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded transition-colors"
          aria-label="Upload PDF"
        >
          <span className="hidden sm:inline">Upload PDF</span>
          <span className="sm:hidden">Upload</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Export — only in editor mode */}
        {hasPdf && appMode === 'editor' && (
          <button
            onClick={onExport}
            disabled={isExporting}
            className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-500 rounded transition-colors disabled:opacity-50"
          >
            {isExporting ? 'Exporting…' : 'Export PDF'}
          </button>
        )}
      </div>
    </header>
  )
}
