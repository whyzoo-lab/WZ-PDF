import { useEffect, useRef, useState } from 'react'
import type { SignatureInfo } from '../../services/pdfSignatures'
import { LANG, t } from '../../i18n'

const when = (d: Date | null) => d ? d.toLocaleString(LANG === 'ko' ? 'ko-KR' : 'en-US') : ''

/** Overall state for the title bar: valid, valid with later changes, or a problem. */
export function SignatureBadge({ list, onOpen }: { list: SignatureInfo[]; onOpen: () => void }) {
  const bad = list.some(s => s.status !== 'valid')
  const later = !bad && !list[list.length - 1]?.coversWholeFile
  const tone = bad ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' : later ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
  return (
    <button type="button" onClick={onOpen} title={t('sign.badgeTitle')}
      className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {bad ? '⚠ ' : '✔ '}{t(bad ? 'sign.badgeBad' : 'sign.badge', { n: list.length })}
    </button>
  )
}

/** Each signature: who, when, and what the check found. */
export function SignaturePanel({ list, onClose, onGo }: { list: SignatureInfo[]; onClose: () => void; onGo: (page: number) => void }) {
  return (
    <aside aria-label={t('sign.panel')}
      className="no-print absolute bottom-0 right-0 top-0 z-30 flex w-80 max-w-full shrink-0 flex-col border-l border-gray-300 bg-white shadow-xl md:static dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <h2 className="flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{t('sign.panel')}</h2>
        <button type="button" onClick={onClose} aria-label={t('sign.close')} className="rounded px-1.5 text-lg leading-none text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">×</button>
      </div>
      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 text-xs">
        {list.map((s, i) => (
          <li key={i} className="rounded-md border border-gray-200 p-2 dark:border-gray-700">
            <div className="flex items-center gap-1.5">
              <span className={`rounded px-1 text-[11px] text-white ${s.status === 'valid' ? 'bg-green-600' : s.status === 'invalid' ? 'bg-red-600' : 'bg-gray-500'}`}>
                {t(`sign.status.${s.status}`)}
              </span>
              <span className="truncate font-medium text-gray-900 dark:text-gray-100">{s.signer}</span>
            </div>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] text-gray-600 dark:text-gray-300">
              {s.signedAt && <><dt>{t('sign.when')}</dt><dd>{when(s.signedAt)}</dd></>}
              {s.reason && <><dt>{t('sign.reason')}</dt><dd className="break-words">{s.reason}</dd></>}
              {s.location && <><dt>{t('sign.location')}</dt><dd className="break-words">{s.location}</dd></>}
              {s.certifies && <><dt>{t('sign.certifies')}</dt><dd>{t(`sign.mdp.${s.certifies}`)}</dd></>}
            </dl>
            <p className="mt-1.5 text-[11px] leading-snug text-gray-600 break-keep dark:text-gray-300">
              {s.status === 'valid'
                ? t(s.coversWholeFile ? 'sign.intact' : 'sign.changedAfter')
                : s.status === 'invalid' ? t('sign.broken') : t('sign.unknown')}
            </p>
            <p className="mt-0.5 text-[11px] text-gray-400 break-keep">{t('sign.identity')}</p>
            {s.page && (
              <button type="button" onClick={() => onGo(s.page!)} className="mt-1 text-[11px] text-blue-600 hover:underline dark:text-blue-400">
                {t('sign.goTo', { n: s.page })}
              </button>
            )}
          </li>
        ))}
      </ol>
    </aside>
  )
}

/** The certificate file and what to write with the signature. */
export function SignDialog({ busy, error, onSign, onCancel }: {
  busy: boolean
  error: string | null
  onSign: (input: { file: File; password: string; reason: string; location: string; visible: boolean }) => void
  onCancel: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [location, setLocation] = useState('')
  const [visible, setVisible] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onCancel() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])
  const field = 'wz-compact-input w-full rounded bg-gray-900 px-2 py-1.5 text-xs text-gray-100 outline-none ring-1 ring-white/10 focus:ring-blue-500'
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <form role="dialog" aria-modal="true" aria-labelledby="wz-sign-title"
        className="w-full max-w-sm rounded-xl bg-gray-800 p-5 text-gray-100 shadow-2xl ring-1 ring-white/10"
        onSubmit={e => { e.preventDefault(); if (file) onSign({ file, password, reason, location, visible }) }}>
        <h2 id="wz-sign-title" className="text-sm font-semibold">{t('sign.title')}</h2>
        <p className="mt-1 text-xs leading-relaxed text-gray-400 break-keep">{t('sign.body')}</p>
        <div className="mt-3 space-y-2 text-xs">
          <div>
            <input ref={fileRef} type="file" accept=".pfx,.p12,application/x-pkcs12" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => fileRef.current?.click()} className="w-full rounded bg-gray-900 px-2 py-1.5 text-left ring-1 ring-white/10 hover:ring-white/30">
              {file ? file.name : t('sign.pickFile')}
            </button>
          </div>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={t('sign.password')} aria-label={t('sign.password')}
            autoComplete="off" onKeyDown={e => e.stopPropagation()} className={field} />
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder={t('sign.reasonHint')} aria-label={t('sign.reason')} onKeyDown={e => e.stopPropagation()} className={field} />
          <input value={location} onChange={e => setLocation(e.target.value)} placeholder={t('sign.locationHint')} aria-label={t('sign.location')} onKeyDown={e => e.stopPropagation()} className={field} />
          <label className="flex items-center gap-2 text-gray-200">
            <input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)} />
            {t('sign.visible')}
          </label>
          {error && <p role="alert" className="rounded bg-red-950/60 px-2 py-1.5 text-red-200 break-keep">{error}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-full px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10 disabled:opacity-40">{t('sign.cancel')}</button>
          <button type="submit" disabled={busy || !file} className="rounded-full bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40">
            {busy ? t('sign.signing') : visible ? t('sign.next') : t('sign.signSave')}
          </button>
        </div>
      </form>
    </div>
  )
}
