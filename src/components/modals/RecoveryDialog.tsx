import { useEffect, useRef } from 'react'
import { t } from '../../i18n'

export interface RecoveryItem {
  key: string
  name: string
  path?: string
  savedAt: number
}

/** "5 minutes ago", "yesterday 14:20" — how long ago the autosave was taken. */
function ago(savedAt: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - savedAt) / 60_000))
  if (min < 1) return t('recovery.justNow')
  if (min < 60) return t('recovery.minutesAgo', { n: min })
  const h = Math.round(min / 60)
  if (h < 24) return t('recovery.hoursAgo', { n: h })
  return new Date(savedAt).toLocaleString()
}

/**
 * Offered at start when the last session ended without saving — a crash, a
 * power cut, a killed process (pattern from PdfCraft's recovery prompt). Each
 * document can be brought back on its own; "Discard all" removes them, and
 * "Later" keeps them for the next start.
 */
export function RecoveryDialog({ items, onRecover, onDiscardAll, onLater }: {
  items: RecoveryItem[]
  onRecover: (key: string) => void
  onDiscardAll: () => void
  onLater: () => void
}) {
  const firstRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { firstRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onLater() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onLater])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="wz-recovery-title"
        aria-describedby="wz-recovery-body"
        className="w-full max-w-md rounded-xl bg-gray-800 p-5 text-gray-100 shadow-2xl ring-1 ring-white/10"
      >
        <h2 id="wz-recovery-title" className="text-sm font-semibold">{t('recovery.title')}</h2>
        <p id="wz-recovery-body" className="mt-1 text-xs text-gray-300">{t('recovery.body')}</p>
        <ul className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-gray-700">
          {items.map((it, i) => (
            <li key={it.key} className="flex items-center gap-3 border-b border-gray-700 px-3 py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{it.name}</div>
                <div className="truncate text-[11px] text-gray-400">
                  {ago(it.savedAt)}{it.path ? ` · ${it.path.replace(/[\\/][^\\/]*$/, '')}` : ''}
                </div>
              </div>
              <button
                ref={i === 0 ? firstRef : undefined}
                type="button"
                onClick={() => onRecover(it.key)}
                className="shrink-0 rounded-full bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500"
              >{t('recovery.recover')}</button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onDiscardAll}
            className="rounded-full px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10">{t('recovery.discardAll')}</button>
          <button type="button" onClick={onLater}
            className="rounded-full px-3 py-1.5 text-sm text-gray-200 ring-1 ring-white/15 hover:bg-white/10">{t('recovery.later')}</button>
        </div>
      </div>
    </div>
  )
}
