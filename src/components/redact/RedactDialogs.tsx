import { useEffect, useMemo, useState } from 'react'
import { t } from '../../i18n'
import type { Found } from '../../services/redact'

function useEscape(onCancel: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])
}

const SHELL = 'w-full max-w-md rounded-xl bg-gray-800 p-5 text-gray-100 shadow-2xl ring-1 ring-white/10'
const BTN = 'rounded-full px-3 py-1.5 text-sm disabled:opacity-40'

/**
 * Asked before marks are applied: it cannot be taken back once saved, the
 * marked pages become pictures, and hidden information can go too.
 */
export function RedactApplyDialog({ marks, pages, busy, onApply, onCancel }: {
  marks: number
  pages: number
  busy: boolean
  onApply: (removeHidden: boolean) => void
  onCancel: () => void
}) {
  const [removeHidden, setRemoveHidden] = useState(true)
  useEscape(onCancel)
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="wz-redact-title" className={SHELL}>
        <h2 id="wz-redact-title" className="text-sm font-semibold">{t('redact.applyTitle')}</h2>
        <p className="mt-2 text-xs leading-relaxed text-gray-300 break-keep">{t('redact.applyBody', { n: marks, pages })}</p>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-gray-300 break-keep">
          <li>{t('redact.applyRemoves')}</li>
          <li>{t('redact.applyPicture')}</li>
          <li>{t('redact.applyUndo')}</li>
        </ul>
        <label className="mt-3 flex items-start gap-2 text-xs text-gray-200">
          <input type="checkbox" checked={removeHidden} onChange={e => setRemoveHidden(e.target.checked)} className="mt-0.5" />
          <span className="break-keep">{t('redact.removeHidden')}</span>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className={`${BTN} text-gray-300 hover:bg-white/10`}>{t('redact.cancel')}</button>
          <button type="button" onClick={() => onApply(removeHidden)} disabled={busy} autoFocus
            className={`${BTN} bg-red-600 font-medium text-white hover:bg-red-500`}>{busy ? t('redact.applying') : t('redact.apply')}</button>
        </div>
      </div>
    </div>
  )
}

/** Personal-information patterns and typed text, found in the document and marked. */
const PATTERN_IDS = ['rrn', 'mobile', 'phone', 'email', 'card', 'bizno'] as const

export function RedactFindDialog({ onSearch, onMark, onCancel }: {
  onSearch: (patterns: string[], text: string) => Promise<Found[]>
  onMark: (found: Found[]) => void
  onCancel: () => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(['rrn', 'mobile', 'phone', 'email', 'card']))
  const [text, setText] = useState('')
  const [found, setFound] = useState<Found[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [skip, setSkip] = useState<Set<number>>(new Set())
  useEscape(onCancel)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of found ?? []) m.set(f.pattern, (m.get(f.pattern) ?? 0) + 1)
    return m
  }, [found])

  const search = async () => {
    setBusy(true)
    try { setFound(await onSearch([...picked], text)); setSkip(new Set()) } finally { setBusy(false) }
  }
  const toggle = (id: string) => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const chosen = (found ?? []).filter((_, i) => !skip.has(i))

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="wz-redact-find-title" className={`${SHELL} flex max-h-[85vh] flex-col`}>
        <h2 id="wz-redact-find-title" className="text-sm font-semibold">{t('redact.findTitle')}</h2>
        <p className="mt-1 text-xs text-gray-400 break-keep">{t('redact.findBody')}</p>
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {PATTERN_IDS.map(id => (
            <label key={id} className="flex items-center gap-2 text-xs text-gray-200">
              <input type="checkbox" checked={picked.has(id)} onChange={() => toggle(id)} />
              {t(`redact.pattern.${id}`)}
              {found && <span className="text-gray-400">({counts.get(id) ?? 0})</span>}
            </label>
          ))}
        </div>
        <input value={text} onChange={e => setText(e.target.value)} placeholder={t('redact.findText')} aria-label={t('redact.findText')}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') void search() }}
          className="wz-compact-input mt-3 rounded bg-gray-900 px-2 py-1.5 text-xs text-gray-100 outline-none ring-1 ring-white/10 focus:ring-blue-500" />
        {found && (
          <ul className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto rounded bg-gray-900/60 p-2 text-xs" aria-label={t('redact.results')}>
            {found.length === 0 && <li className="text-gray-400">{t('redact.noneFound')}</li>}
            {found.map((f, i) => (
              <li key={i}>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={!skip.has(i)} onChange={() => setSkip(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })} />
                  <span className="shrink-0 text-gray-400">{t('redact.page', { n: f.page })}</span>
                  <span className="truncate font-mono">{f.text}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={`${BTN} text-gray-300 hover:bg-white/10`}>{t('redact.cancel')}</button>
          <button type="button" onClick={() => void search()} disabled={busy || (picked.size === 0 && !text.trim())}
            className={`${BTN} text-gray-100 ring-1 ring-white/15 hover:bg-white/10`}>{busy ? t('redact.searching') : t('redact.search')}</button>
          <button type="button" onClick={() => onMark(chosen)} disabled={!found || chosen.length === 0}
            className={`${BTN} bg-red-600 font-medium text-white hover:bg-red-500`}>{t('redact.markN', { n: chosen.length })}</button>
        </div>
      </div>
    </div>
  )
}
