import React, { useRef } from 'react'

interface ActionBarProps {
  hasPdf: boolean
  onUpload: (file: File) => void
  onExport: () => void
  isExporting: boolean
}

export function ActionBar({ hasPdf, onUpload, onExport, isExporting }: ActionBarProps) {
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

  return (
    <header
      className="flex items-center justify-between px-4 py-2 bg-gray-900 text-white shadow-md z-10 shrink-0"
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
    >
      <span className="font-semibold text-sm tracking-wide">PDF Editor</span>
      <div className="flex gap-2">
        <button
          onClick={() => inputRef.current?.click()}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded transition-colors"
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
        {hasPdf && (
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
