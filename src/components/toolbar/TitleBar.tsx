// The thin bar across the top: the document's name, where it is (page) and
// how big (zoom) — and, in the desktop app, the window's own minimise /
// maximise / close, which the OS draws over its right end. It is the colour
// of the page background, so the document area and its title read as one
// surface; the tools live in the dark rail beside them.

import type { DragEvent, ReactNode } from 'react'
import { t } from '../../i18n'

export function TitleBar({ name, unsaved, right, onDrop }: {
  /** Document name; absent with nothing open (the app's own name shows). */
  name?: string
  unsaved?: boolean
  /** Page counter, zoom: right-aligned, before the window controls. */
  right?: ReactNode
  onDrop?: (e: DragEvent) => void
}) {
  return (
    <div
      className="wz-titlebar no-print flex h-8 shrink-0 items-center bg-[var(--wz-canvas)] text-gray-700"
      onDragOver={e => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* Two equal flexible sides keep the name in the middle and cut it short
          before it reaches the controls, whatever their width. */}
      <div className="flex-1 basis-0" aria-hidden />
      <span className="min-w-0 truncate px-3 text-xs font-medium text-gray-700">
        {name ? (
          <>
            {unsaved && (
              <span className="mr-1 text-amber-600" title={t('doc.unsaved')}>●<span className="sr-only">{t('doc.unsaved')}</span></span>
            )}
            {name}
          </>
        ) : (
          <span className="text-gray-500">WZ Reader <span className="tabular-nums">v{__APP_VERSION__}</span></span>
        )}
      </span>
      <div className="flex flex-1 basis-0 items-center justify-end gap-1 pr-2">{right}</div>
    </div>
  )
}
