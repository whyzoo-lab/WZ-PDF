import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { formatSize } from '../../utils/fileSize'

export type OptimizePreset = 'standard' | 'screen' | 'high'

/** Reduce file size: how hard, and what else may go. */
export function OptimizeDialog({ size, busy, onRun, onCancel }: {
  /** The file's size now, bytes. */
  size: number
  busy: boolean
  onRun: (choice: { preset: OptimizePreset; removeHidden: boolean; dropTags: boolean }) => void
  onCancel: () => void
}) {
  const [preset, setPreset] = useState<OptimizePreset>('standard')
  const [removeHidden, setRemoveHidden] = useState(false)
  const [dropTags, setDropTags] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); if (!busy) onCancel() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, onCancel])
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="wz-optimize-title" className="w-full max-w-sm rounded-xl bg-gray-800 p-5 text-gray-100 shadow-2xl ring-1 ring-white/10">
        <h2 id="wz-optimize-title" className="text-sm font-semibold">{t('optimize.title')}</h2>
        <p className="mt-1 text-xs text-gray-400 break-keep">{t('optimize.body', { size: formatSize(size) })}</p>
        <div role="radiogroup" aria-label={t('optimize.preset')} className="mt-3 space-y-1.5 text-xs">
          {(['standard', 'screen', 'high'] as const).map(p => (
            <label key={p} className="flex items-start gap-2">
              <input type="radio" name="wz-optimize" checked={preset === p} onChange={() => setPreset(p)} className="mt-0.5" />
              <span><span className="font-medium text-gray-100">{t(`optimize.preset.${p}`)}</span><br /><span className="text-gray-400">{t(`optimize.presetHint.${p}`)}</span></span>
            </label>
          ))}
        </div>
        <label className="mt-3 flex items-start gap-2 text-xs text-gray-200">
          <input type="checkbox" checked={removeHidden} onChange={e => setRemoveHidden(e.target.checked)} className="mt-0.5" />
          <span className="break-keep">{t('optimize.removeHidden')}</span>
        </label>
        <label className="mt-1.5 flex items-start gap-2 text-xs text-gray-200">
          <input type="checkbox" checked={dropTags} onChange={e => setDropTags(e.target.checked)} className="mt-0.5" />
          <span className="break-keep">{t('optimize.dropTags')}</span>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-full px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10 disabled:opacity-40">{t('optimize.cancel')}</button>
          <button type="button" autoFocus onClick={() => onRun({ preset, removeHidden, dropTags })} disabled={busy}
            className="rounded-full bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40">{busy ? t('optimize.running') : t('optimize.run')}</button>
        </div>
      </div>
    </div>
  )
}
