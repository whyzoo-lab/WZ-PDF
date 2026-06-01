import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'

interface SearchBarProps {
  total: number
  activeIndex: number
  isSearching: boolean
  onChange: (query: string) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

/**
 * Floating find bar (Ctrl+F). Top-right overlay. Debounces input, shows
 * "current / total", and navigates with Enter / Shift+Enter and ↑ ↓ buttons.
 * Esc closes.
 */
export function SearchBar({
  total, activeIndex, isSearching, onChange, onNext, onPrev, onClose,
}: SearchBarProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Focus the input when the bar opens.
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleChange = (v: string) => {
    setValue(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onChange(v), 220)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      // Run immediately if a debounce is pending, otherwise navigate.
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
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
  const counter = !hasQuery ? '' : isSearching ? '…' : total === 0 ? t('search.noResults') : `${activeIndex + 1} / ${total}`

  return (
    <div className="fixed top-16 right-4 z-50 flex items-center gap-1 rounded-lg border border-gray-600 bg-gray-800 px-2 py-1.5 shadow-2xl no-print">
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
        className="w-40 bg-transparent text-sm text-gray-100 placeholder-gray-500 outline-none sm:w-56"
        spellCheck={false}
      />
      <span className="min-w-[52px] text-right text-xs tabular-nums text-gray-400">{counter}</span>
      <button
        onClick={onPrev}
        disabled={total === 0}
        title={t('search.prev')}
        aria-label={t('search.prev')}
        className="flex h-7 w-7 items-center justify-center rounded text-gray-300 hover:bg-gray-700 disabled:opacity-40"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M14 12l-4-4-4 4" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      <button
        onClick={onNext}
        disabled={total === 0}
        title={t('search.next')}
        aria-label={t('search.next')}
        className="flex h-7 w-7 items-center justify-center rounded text-gray-300 hover:bg-gray-700 disabled:opacity-40"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      <button
        onClick={onClose}
        title={t('search.close')}
        aria-label={t('search.close')}
        className="flex h-7 w-7 items-center justify-center rounded text-gray-300 hover:bg-gray-700"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M5 5l10 10M15 5L5 15" strokeLinecap="round"/></svg>
      </button>
    </div>
  )
}
