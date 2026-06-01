import { useState, useRef, useEffect } from 'react'
import { t } from '../../i18n'

interface OpenUrlModalProps {
  loading: boolean
  onSubmit: (url: string) => void
  onCancel: () => void
}

/** Small modal to open an online PDF by URL. */
export function OpenUrlModal({ loading, onSubmit, onCancel }: OpenUrlModalProps) {
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = () => {
    if (url.trim() && !loading) onSubmit(url)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget && !loading) onCancel() }}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
        <h2 className="mb-1 text-lg font-semibold text-gray-800">{t('url.title')}</h2>
        <p className="mb-4 text-sm text-gray-500">{t('url.hint')}</p>
        <input
          ref={inputRef}
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); submit() }
            else if (e.key === 'Escape') { e.preventDefault(); if (!loading) onCancel() }
          }}
          placeholder="https://example.com/document.pdf"
          disabled={loading}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          >
            {t('url.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={loading || url.trim().length === 0}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />}
            {loading ? t('url.loading') : t('url.load')}
          </button>
        </div>
      </div>
    </div>
  )
}
