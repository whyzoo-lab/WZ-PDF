import { useEffect, useRef } from 'react'
import type { Comparison, ChangeKind } from '../../services/textCompare'
import { t } from '../../i18n'

const BADGE: Record<ChangeKind, string> = {
  replaced: 'bg-amber-500 text-white',
  inserted: 'bg-green-600 text-white',
  deleted: 'bg-red-600 text-white',
}

/**
 * The comparison's findings, beside the document: a summary, then every
 * change with what it was and what it is, the open document's page, and a
 * click to go there. After PdfCraft's compare panel.
 */
export function ComparePanel({ result, oldName, active, onPick, onClose, onSaveReport }: {
  result: Comparison
  /** The file compared against (the earlier version). */
  oldName: string
  active: number | null
  onPick: (index: number) => void
  onClose: () => void
  onSaveReport: () => void
}) {
  const listRef = useRef<HTMLOListElement>(null)
  const count = (k: ChangeKind) => result.changes.filter(c => c.kind === k).length
  useEffect(() => {
    if (active === null) return
    listRef.current?.querySelector<HTMLElement>(`[data-change="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])
  const step = (d: 1 | -1) => {
    const n = result.changes.length
    if (n) onPick(active === null ? (d > 0 ? 0 : n - 1) : (active + d + n) % n)
  }

  return (
    <aside aria-label={t('compare.title')}
      className="no-print absolute bottom-0 right-0 top-0 z-30 flex w-80 max-w-full shrink-0 flex-col border-l md:static border-gray-300 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('compare.title')}</h2>
          <p className="truncate text-[11px] text-gray-500 dark:text-gray-400" title={oldName}>{t('compare.against', { name: oldName })}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t('compare.close')} title={t('compare.close')}
          className="rounded px-1.5 text-lg leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-white">×</button>
      </div>

      <div className="flex items-center gap-1.5 border-b border-gray-200 px-3 py-2 text-[11px] dark:border-gray-700">
        {result.changes.length === 0 ? (
          <span className="text-green-700 dark:text-green-400">{t('compare.identical')}</span>
        ) : (
          <>
            <span className={`rounded px-1.5 py-0.5 ${BADGE.replaced}`}>{t('compare.kind.replaced')} {count('replaced')}</span>
            <span className={`rounded px-1.5 py-0.5 ${BADGE.inserted}`}>{t('compare.kind.inserted')} {count('inserted')}</span>
            <span className={`rounded px-1.5 py-0.5 ${BADGE.deleted}`}>{t('compare.kind.deleted')} {count('deleted')}</span>
            <span className="ml-auto flex">
              <button type="button" onClick={() => step(-1)} aria-label={t('compare.prev')} title={t('compare.prev')} className="rounded px-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">↑</button>
              <button type="button" onClick={() => step(1)} aria-label={t('compare.next')} title={t('compare.next')} className="rounded px-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">↓</button>
            </span>
          </>
        )}
      </div>

      <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {result.changes.map((c, i) => (
          <li key={i} data-change={i}>
            <button type="button" onClick={() => onPick(i)} aria-current={i === active}
              className={`mb-1.5 block w-full rounded-md border p-2 text-left text-xs ${i === active ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200 hover:border-gray-400 dark:border-gray-700'}`}>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                <span className={`rounded px-1 ${BADGE[c.kind]}`}>{t(`compare.kind.${c.kind}`)}</span>
                <span>{t('compare.page', { n: c.new.page })}</span>
              </div>
              {c.old.text && <p className="break-words text-red-700 line-through decoration-red-400 dark:text-red-400">{c.old.text}</p>}
              {c.new.text && <p className="break-words text-green-800 dark:text-green-400">{c.new.text}</p>}
            </button>
          </li>
        ))}
      </ol>

      <div className="border-t border-gray-200 p-2 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
        <p className="mb-1.5">{t('compare.words', { old: result.oldWords, new: result.newWords })}</p>
        <button type="button" onClick={onSaveReport}
          className="w-full rounded bg-gray-100 px-2 py-1.5 text-xs text-gray-800 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700">
          {t('compare.saveReport')}
        </button>
      </div>
    </aside>
  )
}
