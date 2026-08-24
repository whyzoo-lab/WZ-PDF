import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'

/**
 * Asks for the password of an encrypted PDF.
 *
 * Imported directly rather than lazily like the other modals: it appears in the
 * middle of opening a document, and the other modals are lazy because they
 * carry real weight (a drawing canvas, a form). Making the reader wait on a
 * chunk fetch to be asked a question would be the wrong trade.
 *
 * The password is held in local state and handed straight to pdfjs. It is never
 * stored, never logged, and never leaves the process — same promise as the rest
 * of the app, and worth keeping true for the one input that would matter most.
 */
export interface PasswordPromptProps {
  /** True when the previous attempt was rejected. */
  wrong: boolean
  onSubmit: (password: string) => void
  onCancel: () => void
}

export function PasswordPrompt({ wrong, onSubmit, onCancel }: PasswordPromptProps) {
  const [password, setPassword] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus on open, and again after a rejected attempt — the reader's next move
  // is to type either way.
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [wrong])

  // Escape closes it, like every other dialog in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length === 0) return
    onSubmit(password)
    // Cleared immediately: if it was wrong the field is asked for again, and
    // there is no reason to keep the last attempt sitting in memory.
    setPassword('')
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={t('password.title')}
        className="w-full max-w-sm rounded-xl bg-gray-800 p-5 text-gray-100 shadow-2xl ring-1 ring-white/10"
      >
        <h2 className="text-sm font-semibold">{t('password.title')}</h2>
        <p className={`mt-1 text-xs ${wrong ? 'text-red-300' : 'text-gray-400'}`}>
          {wrong ? t('password.wrong') : t('password.body')}
        </p>

        <label className="mt-3 block">
          <span className="sr-only">{t('password.label')}</span>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="off"
            className="w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm
                       text-gray-100 outline-none focus:border-blue-500"
            placeholder={t('password.label')}
          />
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10"
          >{t('password.cancel')}</button>
          <button
            type="submit"
            disabled={password.length === 0}
            className="rounded-full bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-500
                       disabled:opacity-40"
          >{t('password.open')}</button>
        </div>
      </form>
    </div>
  )
}
