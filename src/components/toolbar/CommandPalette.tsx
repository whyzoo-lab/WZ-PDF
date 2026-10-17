// Ctrl+K: every command the app has, found by typing.
//
// After PdfCraft's palette (crates/ui-egui/src/palette.rs, Apache-2.0/MIT): one
// list of commands — the same handlers the rail and menus call — searched by
// the label in the UI language, the English label and the id, best match
// first, twelve at most; commands that cannot run now are shown greyed and
// last. Arrow keys move, Enter runs, Escape or a click outside closes.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { rank, type Searchable } from './commandSearch'
import { t } from '../../i18n'

export interface PaletteCommand extends Searchable {
  /** Shown on the right when there is no shortcut: which part of the app it belongs to. */
  group: string
  shortcut?: string
  icon?: ReactNode
  run: () => void
}

export function CommandPalette({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const hits = useMemo(() => rank(commands, query), [commands, query])
  const active = Math.min(sel, Math.max(0, hits.length - 1))

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const run = (c: PaletteCommand | undefined) => {
    if (!c || c.disabled) return
    onClose()
    c.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(active + 1, hits.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(active - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); run(hits[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
  }

  return (
    <div className="no-print fixed inset-0 z-[90] flex justify-center bg-black/20 px-4 pt-[12vh]">
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        className="h-fit w-full max-w-[560px] overflow-hidden rounded-xl bg-gray-800 text-gray-100 shadow-2xl ring-1 ring-white/10"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setSel(0) }}
          onKeyDown={onKeyDown}
          placeholder={t('palette.placeholder')}
          role="combobox"
          aria-expanded="true"
          aria-controls="wz-palette-list"
          aria-activedescendant={hits[active] ? `wz-cmd-${hits[active].id}` : undefined}
          className="w-full border-b border-gray-700 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-gray-500"
        />
        <ul id="wz-palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
          {hits.length === 0 && <li className="px-4 py-3 text-xs text-gray-400">{t('palette.none')}</li>}
          {hits.map((c, i) => (
            <li
              key={c.id}
              id={`wz-cmd-${c.id}`}
              role="option"
              aria-selected={i === active}
              aria-disabled={c.disabled || undefined}
              onMouseMove={() => setSel(i)}
              onClick={() => run(c)}
              className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm ${i === active ? 'bg-white/10' : ''} ${c.disabled ? 'opacity-40' : ''}`}
            >
              <span className="flex w-4 shrink-0 justify-center text-gray-300">{c.icon}</span>
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              {c.shortcut
                ? <kbd className="shrink-0 font-sans text-[11px] text-gray-400">{c.shortcut}</kbd>
                : <span className="shrink-0 text-[11px] text-gray-500">{c.group}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
