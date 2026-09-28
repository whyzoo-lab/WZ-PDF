import { useEffect, useState } from 'react'
import { t } from '../i18n'

interface RecentEntry { path: string; openedAt: number }

export interface StartScreenProps {
  /** Show the file picker. */
  onOpenFile: () => void
  /** Open a recent document by path. Resolves false when it could not be opened. */
  onOpenRecent: (path: string) => Promise<boolean>
}

function splitPath(p: string): { name: string; folder: string } {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i < 0 ? { name: p, folder: '' } : { name: p.slice(i + 1), folder: p.slice(0, i) }
}

/**
 * What the window shows with nothing open.
 *
 * It used to be one line of grey text naming an "Open" button that had no such
 * label, with the whole area secretly clickable. Now there is a real button,
 * and — in the desktop app — the documents opened last, which is what most
 * launches are for. The list is paths only, kept by the main process in the
 * app's own folder; nothing from inside a document is stored.
 */
export function StartScreen({ onOpenFile, onOpenRecent }: StartScreenProps) {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  const [recent, setRecent] = useState<RecentEntry[]>([])

  useEffect(() => {
    let cancelled = false
    api?.recentFiles?.().then(list => { if (!cancelled) setRecent(list) }, () => {})
    return () => { cancelled = true }
  }, [api])

  const open = async (path: string) => {
    // A file that has moved or been deleted leaves the list rather than failing
    // the same way every time it is clicked.
    if (!(await onOpenRecent(path))) {
      api?.removeRecentFile?.(path).then(setRecent, () => {})
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center select-none">
      <div className="flex flex-col items-center gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-500 sm:h-14 sm:w-14" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <button
          type="button"
          onClick={onOpenFile}
          className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
        >{t('start.open')}</button>
        {/* keep-all: Korean wraps between words, not mid-word ("버/튼"). */}
        <p className="max-w-md text-sm text-gray-400 break-keep">
          <span className="hidden sm:inline">{t('empty.desktop')}</span>
          <span className="sm:hidden">{t('empty.mobile')}</span>
        </p>
      </div>

      {recent.length > 0 && (
        <section className="w-full max-w-md text-left" aria-labelledby="wz-recent-title">
          <div className="mb-1.5 flex items-baseline justify-between px-1">
            <h2 id="wz-recent-title" className="text-xs font-semibold text-gray-300">{t('start.recent')}</h2>
            <button
              type="button"
              onClick={() => { api?.clearRecentFiles?.().then(setRecent, () => {}) }}
              className="text-xs text-gray-400 hover:text-gray-200"
            >{t('start.clearRecent')}</button>
          </div>
          <ul className="overflow-hidden rounded-lg border border-gray-700/70 bg-gray-800/40">
            {recent.map(r => {
              const { name, folder } = splitPath(r.path)
              return (
                <li key={r.path} className="border-b border-gray-700/50 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => { void open(r.path) }}
                    title={r.path}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-white/5 focus-visible:bg-white/10 focus-visible:outline-none"
                  >
                    <span className="w-full truncate text-sm text-gray-100">{name}</span>
                    <span className="w-full truncate text-xs text-gray-400">{folder}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
