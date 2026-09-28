import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'

export interface UnsavedChangesDialogProps {
  /** The document with the unsaved changes. */
  fileName: string
  /** Save, then go on. Resolves false when the save did not happen (cancelled or failed). */
  onSave: () => Promise<boolean>
  /** Go on without saving. */
  onDiscard: () => void
  /** Stay on the current document. */
  onCancel: () => void
}

/**
 * Asked before another document replaces one with unsaved changes.
 *
 * Opening a file used to drop stamps, signatures, page edits and Markdown edits
 * without a word. Three answers, in the order every editor uses: save first,
 * leave them, or stay. Save is the default (Enter) because it is the one that
 * cannot lose anything; Escape stays.
 *
 * Imported directly, not lazily: it has to appear the moment a file is picked.
 */
export function UnsavedChangesDialog({ fileName, onSave, onDiscard, onCancel }: UnsavedChangesDialogProps) {
  const [saving, setSaving] = useState(false)
  const saveRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { saveRef.current?.focus() }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const save = async () => {
    setSaving(true)
    try {
      // Go on only once the file is really written; a cancelled or failed save
      // leaves the reader where they were, changes intact.
      if (!(await onSave())) setSaving(false)
    } catch {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="wz-unsaved-title"
        aria-describedby="wz-unsaved-body"
        className="w-full max-w-sm rounded-xl bg-gray-800 p-5 text-gray-100 shadow-2xl ring-1 ring-white/10"
      >
        <h2 id="wz-unsaved-title" className="text-sm font-semibold">{t('unsaved.title')}</h2>
        <p id="wz-unsaved-body" className="mt-1 text-xs text-gray-300 break-words">
          {t('unsaved.body', { name: fileName })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-full px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10 disabled:opacity-40"
          >{t('unsaved.cancel')}</button>
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="rounded-full px-3 py-1.5 text-sm text-gray-200 ring-1 ring-white/15 hover:bg-white/10 disabled:opacity-40"
          >{t('unsaved.discard')}</button>
          <button
            ref={saveRef}
            type="button"
            onClick={() => { void save() }}
            disabled={saving}
            className="rounded-full bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
          >{t('unsaved.save')}</button>
        </div>
      </div>
    </div>
  )
}
