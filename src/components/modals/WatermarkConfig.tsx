import React, { useState } from 'react'

export interface WatermarkSettings {
  text: string
  opacity: number
  fontSize: number
  color: string
  rotation: number
}

interface WatermarkConfigProps {
  onConfirm: (settings: WatermarkSettings) => void
  onCancel: () => void
}

export function WatermarkConfig({ onConfirm, onCancel }: WatermarkConfigProps) {
  const [settings, setSettings] = useState<WatermarkSettings>({
    text: 'CONFIDENTIAL',
    opacity: 0.3,
    fontSize: 48,
    color: '#888888',
    rotation: -45,
  })

  const set =
    (key: keyof WatermarkSettings) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value =
        e.target.type === 'range' || e.target.type === 'number'
          ? parseFloat(e.target.value)
          : e.target.value
      setSettings(prev => ({ ...prev, [key]: value }))
    }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 shadow-2xl w-full max-w-sm">
        <h2 className="text-lg font-semibold mb-4 text-gray-800">Watermark Settings</h2>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Text
            <input
              type="text"
              value={settings.text}
              onChange={set('text')}
              className="border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Opacity ({Math.round(settings.opacity * 100)}%)
            <input type="range" min={0.05} max={1} step={0.05} value={settings.opacity} onChange={set('opacity')} className="accent-blue-500" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Font Size ({settings.fontSize}pt)
            <input type="range" min={12} max={120} step={4} value={settings.fontSize} onChange={set('fontSize')} className="accent-blue-500" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Color
            <input type="color" value={settings.color} onChange={set('color')} className="h-9 w-full rounded border border-gray-300 cursor-pointer" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Rotation ({settings.rotation}°)
            <input type="range" min={-90} max={90} step={5} value={settings.rotation} onChange={set('rotation')} className="accent-blue-500" />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(settings)}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
