import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import type { FindOptions, Snippet } from '../services/textSearch'

export interface SearchResult {
  /** Page number, for page documents. */
  page?: number
  snippet?: Snippet
}

interface SearchBarProps {
  total: number
  activeIndex: number
  isSearching: boolean
  /** Pages searched so far while a search runs ("3 / 16+", "searching 12/40"). */
  progress?: { done: number; total: number } | null
  options?: FindOptions
  onOptionsChange?: (options: FindOptions) => void
  /** Every match with its context, for the list; absent where the engine has none. */
  results?: SearchResult[]
  onSelect?: (index: number) => void
  onChange: (query: string) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

/** Rows the results list draws; a one-letter query on a long document finds thousands. */
const LIST_LIMIT = 500

/**
 * Floating find bar (Ctrl+F), top right. Debounces input, shows "current /
 * total" ("+" while the rest of the document is still being searched), and
 * navigates with Enter / Shift+Enter and the arrows. Case and whole-word are
 * toggles; the list button shows every match with a line of context, page by
 * page (after PdfCraft's find bar and its Advanced Search panel). Esc closes.
 */
export function SearchBar({
  total, activeIndex, isSearching, progress, options, onOptionsChange, results, onSelect,
  onChange, onNext, onPrev, onClose,
}: SearchBarProps) {
  const [value, setValue] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listRef = useRef<HTMLOListElement>(null)

  // Focus the input when the bar opens.
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Keep the current match in view in the list.
  useEffect(() => {
    if (!listOpen) return
    listRef.current?.querySelector<HTMLElement>(`[data-i="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, listOpen])

  const handleChange = (v: string) => {
    setValue(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    // Cleared when it fires: a spent timer id left in the ref read as "still
    // pending", so every Enter after typing re-ran the search from match 1
    // instead of moving to the next one.
    debounceRef.current = setTimeout(() => { debounceRef.current = null; onChange(v) }, 220)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      // Run immediately if a debounce is pending, otherwise navigate.
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
        onChange(value)
      } else if (e.shiftKey) {
        onPrev()
      } else {
        onNext()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const hasQuery = value.trim().length > 0
  const counter = !hasQuery ? ''
    : total === 0
      ? (isSearching ? (progress ? t('search.searching', { done: progress.done, total: progress.total }) : '…') : t('search.noResults'))
      : `${activeIndex + 1} / ${total}${isSearching ? '+' : ''}`

  const toggle = (on: boolean) =>
    `flex h-7 min-w-7 items-center justify-center rounded px-1 text-xs ${on ? 'bg-blue-600/80 text-white' : 'text-gray-300 hover:bg-gray-700'}`

  return (
    <div className="fixed top-10 right-4 z-50 w-[min(100vw-2rem,30rem)] no-print">
      <div className="flex items-center gap-1 rounded-lg border border-gray-600 bg-gray-800 px-2 py-1.5 shadow-2xl">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 text-gray-400 shrink-0">
          <circle cx="9" cy="9" r="6" />
          <path d="M14 14l4 4" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('search.placeholder')}
          className="min-w-0 flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-500 outline-none"
          spellCheck={false}
        />
        <span className="min-w-[52px] shrink-0 text-right text-xs tabular-nums text-gray-400" aria-live="polite">{counter}</span>
        {options && onOptionsChange && (
          <>
            <button
              type="button"
              aria-pressed={options.caseSensitive}
              onClick={() => onOptionsChange({ ...options, caseSensitive: !options.caseSensitive })}
              title={t('search.caseSensitive')}
              aria-label={t('search.caseSensitive')}
              className={toggle(options.caseSensitive)}
            >Aa</button>
            <button
              type="button"
              aria-pressed={options.wholeWord}
              onClick={() => onOptionsChange({ ...options, wholeWord: !options.wholeWord })}
              title={t('search.wholeWord')}
              aria-label={t('search.wholeWord')}
              className={toggle(options.wholeWord)}
            ><span className="underline decoration-1 underline-offset-2">ab</span></button>
          </>
        )}
        {results && (
          <button
            type="button"
            aria-pressed={listOpen}
            aria-expanded={listOpen}
            onClick={() => setListOpen(v => !v)}
            title={t('search.list')}
            aria-label={t('search.list')}
            className={toggle(listOpen)}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="M4 5h12M4 10h12M4 15h12" strokeLinecap="round" /></svg>
          </button>
        )}
        <button
          onClick={onPrev}
          disabled={total === 0}
          title={t('search.prev')}
          aria-label={t('search.prev')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-300 hover:bg-gray-700 disabled:opacity-40"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M14 12l-4-4-4 4" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button
          onClick={onNext}
          disabled={total === 0}
          title={t('search.next')}
          aria-label={t('search.next')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-300 hover:bg-gray-700 disabled:opacity-40"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button
          onClick={onClose}
          title={t('search.close')}
          aria-label={t('search.close')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-300 hover:bg-gray-700"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M5 5l10 10M15 5L5 15" strokeLinecap="round"/></svg>
        </button>
      </div>

      {listOpen && results && hasQuery && (
        <ol
          ref={listRef}
          aria-label={t('search.list')}
          className="mt-1 max-h-[55vh] overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-2xl"
        >
          {results.length === 0 && <li className="px-3 py-2 text-xs text-gray-400">{isSearching ? '…' : t('search.noResults')}</li>}
          {results.slice(0, LIST_LIMIT).map((r, i) => (
            <li key={i}>
              <button
                type="button"
                data-i={i}
                onClick={() => onSelect?.(i)}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs ${i === activeIndex ? 'bg-white/10' : 'hover:bg-white/5'}`}
              >
                {r.page !== undefined && <span className="w-10 shrink-0 tabular-nums text-gray-500">{t('search.page', { n: r.page })}</span>}
                <span className="min-w-0 flex-1 truncate text-gray-300">
                  {r.snippet && (<>{r.snippet.before}<mark className="rounded-sm bg-amber-400/80 px-0.5 text-gray-900">{r.snippet.hit}</mark>{r.snippet.after}</>)}
                </span>
              </button>
            </li>
          ))}
          {results.length > LIST_LIMIT && (
            <li className="px-3 py-1.5 text-[11px] text-gray-500">{t('search.more', { n: results.length - LIST_LIMIT })}</li>
          )}
        </ol>
      )}
    </div>
  )
}
