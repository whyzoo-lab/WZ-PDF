// The thin bar across the top: the document's name, where it is (page) and
// how big (zoom) — and, in the desktop app, the window's own minimise /
// maximise / close, which the OS draws over its right end. It is the colour
// of the page background, so the document area and its title read as one
// surface; the tools live in the dark rail beside them.

import type { DragEvent, ReactNode } from 'react'
import { t } from '../../i18n'

export interface TitleTab { id: string; label: string; unsaved: boolean; active: boolean }

export function TitleBar({ name, unsaved, badge, right, onDrop, tabs, onTab, onCloseTab }: {
  /** Document name; absent with nothing open (the app's own name shows). */
  name?: string
  unsaved?: boolean
  /** Beside the name: the signatures' state. */
  badge?: ReactNode
  /** Page counter, zoom: right-aligned, before the window controls. */
  right?: ReactNode
  onDrop?: (e: DragEvent) => void
  /** Open documents; shown as tabs in place of the name when there are two or more. */
  tabs?: TitleTab[]
  onTab?: (id: string) => void
  onCloseTab?: (id: string) => void
}) {
  if (tabs && tabs.length > 1 && onTab && onCloseTab) {
    return (
      <div className="wz-titlebar no-print flex h-8 shrink-0 items-end bg-[var(--wz-canvas)] text-gray-700 dark:text-gray-200"
        onDragOver={e => e.preventDefault()} onDrop={onDrop}>
        <div role="tablist" aria-label={t('tabs.label')} className="wz-no-scrollbar flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto pl-2">
          {tabs.map(tab => (
            <div key={tab.id} role="presentation"
              className={`group flex h-7 min-w-0 max-w-[200px] shrink items-center rounded-t-md text-xs ${tab.active ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100' : 'text-gray-600 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10'}`}>
              <button type="button" role="tab" aria-selected={tab.active} title={tab.label}
                onClick={() => onTab(tab.id)}
                onMouseDown={e => { if (e.button === 1) { e.preventDefault(); onCloseTab(tab.id) } }}
                className="flex min-w-0 flex-1 items-center gap-1 py-1 pl-2.5 pr-1 text-left">
                {tab.unsaved && <span className="shrink-0 text-amber-600" aria-label={t('doc.unsaved')}>●</span>}
                <span className="truncate">{tab.label}</span>
              </button>
              <button type="button" onClick={() => onCloseTab(tab.id)} aria-label={t('tabs.close', { name: tab.label })} title={t('tabs.closeHint')}
                className={`mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-black/10 hover:text-gray-800 dark:hover:bg-white/15 dark:hover:text-white ${tab.active ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          ))}
          {/* What is left of the bar still drags the window. */}
          <div className="wz-drag h-full min-w-6 flex-1" aria-hidden />
        </div>
        {badge && <div className="flex h-8 shrink-0 items-center">{badge}</div>}
        <div className="flex h-8 shrink-0 items-center justify-end gap-1 pr-2">{right}</div>
      </div>
    )
  }
  return (
    <div
      className="wz-titlebar no-print flex h-8 shrink-0 items-center bg-[var(--wz-canvas)] text-gray-700 dark:text-gray-200"
      onDragOver={e => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* Two equal flexible sides keep the name in the middle and cut it short
          before it reaches the controls, whatever their width. */}
      <div className="flex-1 basis-0" aria-hidden />
      <span className="min-w-0 truncate px-3 text-xs font-medium text-gray-700 dark:text-gray-200">
        {name ? (
          <>
            {unsaved && (
              <span className="mr-1 text-amber-600" title={t('doc.unsaved')}>●<span className="sr-only">{t('doc.unsaved')}</span></span>
            )}
            {name}
            {badge}
          </>
        ) : (
          <span className="text-gray-500 dark:text-gray-400">WZ Reader <span className="tabular-nums">v{__APP_VERSION__}</span></span>
        )}
      </span>
      <div className="flex flex-1 basis-0 items-center justify-end gap-1 pr-2">{right}</div>
    </div>
  )
}
