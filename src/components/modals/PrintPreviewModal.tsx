import { useEffect, useRef } from 'react'
import { t } from '../../i18n'

interface PrintPreviewModalProps {
  /** Composited page images (JPEG data URLs), in print order. */
  pages: string[]
  onConfirm: () => void
  onCancel: () => void
}

/**
 * In-app WYSIWYG print preview. Electron ships without Chrome's print preview,
 * so window.print() there only opens the bare OS dialog. We render the exact
 * page images that will be sent to the printer (annotations baked in) and let
 * the user confirm before the system dialog appears.
 *
 * Marked `no-print` so it never ends up on paper — the actual print uses the
 * hidden `#wz-print-root` container.
 */
export function PrintPreviewModal({ pages, onConfirm, onCancel }: PrintPreviewModalProps) {
  const printBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { printBtnRef.current?.focus() }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      else if (e.key === 'Enter') { e.preventDefault(); onConfirm() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('print.previewTitle')}
      className="no-print fixed inset-0 z-[110] flex flex-col bg-black/60 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-gray-800">{t('print.previewTitle')}</h2>
            <p className="text-xs text-gray-500">{t('print.previewHint')}</p>
          </div>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
            {t('print.pageCount', { total: pages.length })}
          </span>
        </div>

        {/* Scrollable page strip */}
        <div className="flex-1 overflow-y-auto bg-gray-200 px-4 py-5">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-5">
            {pages.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`page ${i + 1}`}
                className="w-full bg-white shadow-md ring-1 ring-black/5"
                draggable={false}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-lg bg-gray-100 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-200"
          >
            {t('print.cancel')}
          </button>
          <button
            ref={printBtnRef}
            onClick={onConfirm}
            className="rounded-lg bg-blue-600 px-5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            {t('print.doPrint')}
          </button>
        </div>
      </div>
    </div>
  )
}
