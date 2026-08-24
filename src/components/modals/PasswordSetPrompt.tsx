import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'

/**
 * Asks for a password to put ON a document being saved.
 *
 * Deliberately separate from `PasswordPrompt`, which asks for the password of a
 * document being opened. The two look similar but are opposite acts: one is a
 * guess that can be wrong and retried, this one is a decision that cannot be
 * checked afterwards — nothing on this side knows whether the reader typed what
 * they meant. That is why it asks twice and refuses to continue until the two
 * agree; a typo here silently produces a file nobody can open.
 *
 * The password lives in local state only. It is handed to the exporter, used to
 * encrypt, and never stored or logged.
 */
export interface PasswordSetPromptProps {
  onSubmit: (password: string) => void
  onCancel: () => void
}

export function PasswordSetPrompt({ onSubmit, onCancel }: PasswordSetPromptProps) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const mismatch = confirm.length > 0 && password !== confirm
  const ready = password.length > 0 && password === confirm

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready) return
    // Called synchronously from the click so the save picker that follows still
    // has the user activation this submit granted.
    onSubmit(password)
  }

  const field = `w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm
                 text-gray-100 outline-none focus:border-blue-500`

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={t('encrypt.title')}
        className="w-full max-w-sm rounded-xl bg-gray-800 p-5 text-gray-100 shadow-2xl ring-1 ring-white/10"
      >
        <h2 className="text-sm font-semibold">{t('encrypt.title')}</h2>
        <p className="mt-1 text-xs text-gray-400">{t('encrypt.body')}</p>

        <label className="mt-3 block">
          <span className="sr-only">{t('encrypt.label')}</span>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="new-password"
            className={field}
            placeholder={t('encrypt.label')}
          />
        </label>

        <label className="mt-2 block">
          <span className="sr-only">{t('encrypt.confirmLabel')}</span>
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password"
            className={field}
            placeholder={t('encrypt.confirmLabel')}
          />
        </label>

        <p className={`mt-2 text-xs ${mismatch ? 'text-red-300' : 'text-gray-500'}`}>
          {mismatch ? t('encrypt.mismatch') : t('encrypt.warning')}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10"
          >{t('password.cancel')}</button>
          <button
            type="submit"
            disabled={!ready}
            className="rounded-full bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-500
                       disabled:opacity-40"
          >{t('encrypt.save')}</button>
        </div>
      </form>
    </div>
  )
}
