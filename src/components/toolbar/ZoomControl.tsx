import { useState, useRef } from 'react'
import { IconZoomIn, IconZoomOut } from './icons'
import { MIN_ZOOM, MAX_ZOOM } from '../../utils/constants'
import { t } from '../../i18n'

/**
 * Chrome-style editable zoom control: [-] [editable %] [+].
 * Type a value + Enter to jump to it; double-click resets to 100%.
 */
export function ZoomControl({
  zoom, onZoomIn, onZoomOut, onZoomSet, onZoomReset, tone = 'dark',
}: {
  zoom: number
  /** On the dark rail, or on the light title bar. */
  tone?: 'dark' | 'light'
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomSet: (zoom: number) => void
  onZoomReset: () => void
}) {
  // `draft` is the in-progress text while the field is focused; when null the
  // field mirrors the live `zoom` prop.
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const shown = draft ?? String(Math.round(zoom * 100))

  const commit = () => {
    if (draft === null) return
    const n = parseInt(draft, 10)
    if (!Number.isNaN(n) && n > 0) {
      onZoomSet(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, n / 100)))
    }
    setDraft(null)
  }

  const light = tone === 'light'
  const stepBtn = light
    ? 'flex items-center justify-center w-7 h-7 rounded-md text-gray-600 transition-all hover:bg-black/10 hover:text-gray-900 disabled:opacity-30 disabled:hover:bg-transparent'
    : 'flex items-center justify-center w-8 h-8 rounded text-gray-300 transition-all ' +
      'hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-300'
  const field = light
    ? 'flex items-center rounded-md px-1 h-6 hover:bg-black/5 focus-within:bg-white focus-within:ring-1 focus-within:ring-blue-500'
    : 'flex items-center rounded px-1 h-8 hover:bg-gray-700/50 focus-within:bg-gray-700 focus-within:ring-1 focus-within:ring-blue-500'

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <button onClick={onZoomOut} disabled={zoom <= MIN_ZOOM} className={stepBtn} title={t('tool.zoomOut')} aria-label={t('tool.zoomOut')}><IconZoomOut /></button>
      <div className={field}>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          aria-label={t('tool.zoomLevel')}
          title={t('tool.zoomReset')}
          value={shown}
          onFocus={e => { const el = e.currentTarget; setDraft(String(Math.round(zoom * 100))); requestAnimationFrame(() => el.select()) }}
          onChange={e => setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { commit(); inputRef.current?.blur() }
            else if (e.key === 'Escape') { setDraft(null); inputRef.current?.blur() }
          }}
          onDoubleClick={() => { setDraft(null); onZoomReset() }}
          className={`w-8 bg-transparent text-right text-xs tabular-nums outline-none ${light ? 'text-gray-800' : 'text-gray-100'}`}
        />
        <span className={`text-xs select-none pl-0.5 pointer-events-none ${light ? 'text-gray-500' : 'text-gray-400'}`}>%</span>
      </div>
      <button onClick={onZoomIn} disabled={zoom >= MAX_ZOOM} className={stepBtn} title={t('tool.zoomIn')} aria-label={t('tool.zoomIn')}><IconZoomIn /></button>
    </div>
  )
}
