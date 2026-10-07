import { useCallback, useEffect, useRef, useState } from 'react'
import { FLOW_PRINT_ATTR } from '../services/htmlPrint'
import { highlightApi, indexText, rangeAt } from '../services/domText'
import { getFlowSearchProvider } from '../services/flowSearchProvider'

/**
 * Find-in-document for the reflowing formats (Markdown, mail).
 *
 * `useSearch` is the page-based equivalent: it reads pdfjs text items and hands
 * back item-index ranges that the text layer paints. Neither half of that exists
 * here — the document is live DOM — so this searches the DOM directly and paints
 * with the **CSS Custom Highlight API**.
 *
 * That API matters: mail and Markdown bodies are attacker-controlled HTML that
 * DOMPurify has already vetted, and the classic "wrap matches in <mark>" trick
 * would mean re-writing that vetted DOM on every keystroke. Highlights are
 * painted from `Range` objects instead, so the document is never touched.
 *
 * The DOM-to-text machinery lives in services/domText.ts, shared with the
 * read-aloud highlighter, which needs exactly the same thing.
 */

/** Every match. Styled in index.css via `::highlight()`. */
export const HL_ALL = 'wz-find'
/** Just the current one, so it stands out from the rest. */
export const HL_ACTIVE = 'wz-find-active'

export interface UseFlowSearchReturn {
  total: number
  activeIndex: number
  run: (query: string) => void
  next: () => void
  prev: () => void
  clear: () => void
}

export function useFlowSearch(enabled: boolean): UseFlowSearchReturn {
  const [total, setTotal] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const rangesRef = useRef<Range[]>([])
  // How many matches there are, whichever engine found them — next/prev wrap
  // on this, since a provider's matches are not Ranges.
  const countRef = useRef(0)

  const paint = useCallback((ranges: Range[], active: number) => {
    const api = highlightApi()
    if (!api) return
    if (ranges.length === 0) {
      api.registry.delete(HL_ALL)
      api.registry.delete(HL_ACTIVE)
      return
    }
    api.registry.set(HL_ALL, new api.Highlight(...ranges))
    const current = ranges[active]
    if (current) api.registry.set(HL_ACTIVE, new api.Highlight(current))
    else api.registry.delete(HL_ACTIVE)
  }, [])

  const clear = useCallback(() => {
    getFlowSearchProvider()?.clear()
    rangesRef.current = []
    countRef.current = 0
    setTotal(0)
    setActiveIndex(0)
    paint([], 0)
  }, [paint])

  const run = useCallback((query: string) => {
    const needle = query.trim().toLowerCase()
    if (!enabled || needle.length === 0) { clear(); return }

    // A view too large for the DOM searches its own data (see flowSearchProvider).
    const provider = getFlowSearchProvider()
    if (provider) {
      rangesRef.current = []
      paint([], 0)
      const count = provider.find(needle)
      countRef.current = count
      setTotal(count)
      setActiveIndex(0)
      if (count > 0) provider.reveal(0)
      return
    }

    const root = document.querySelector<HTMLElement>(`[${FLOW_PRINT_ATTR}]`)
    if (!root) { clear(); return }

    const idx = indexText(root)
    // Case-insensitive, but positions must line up with the original, so the
    // lower-cased copy is searched and the index itself left as it is.
    const haystack = idx.text.toLowerCase()
    const found: Range[] = []
    for (let from = 0; ; ) {
      const at = haystack.indexOf(needle, from)
      if (at < 0) break
      const range = rangeAt(idx, at, needle.length)
      if (range) found.push(range)
      from = at + needle.length
    }

    rangesRef.current = found
    countRef.current = found.length
    setTotal(found.length)
    setActiveIndex(0)
    paint(found, 0)
  }, [enabled, clear, paint])

  const next = useCallback(() => {
    const n = countRef.current
    setActiveIndex(i => (n === 0 ? 0 : (i + 1) % n))
  }, [])

  const prev = useCallback(() => {
    const n = countRef.current
    setActiveIndex(i => (n === 0 ? 0 : (i - 1 + n) % n))
  }, [])

  // Move the active highlight and bring it on screen. Not smooth-scrolled:
  // stepping through matches should land immediately, and a queued animation
  // per keypress reads as lag.
  useEffect(() => {
    const provider = getFlowSearchProvider()
    if (provider) {
      if (countRef.current > 0) provider.reveal(activeIndex)
      return
    }
    const ranges = rangesRef.current
    if (ranges.length === 0) return
    paint(ranges, activeIndex)
    const target = ranges[activeIndex]?.startContainer.parentElement
    target?.scrollIntoView({ block: 'center' })
  }, [activeIndex, total, paint])

  // Highlights are registered globally, so they must not outlive the search.
  useEffect(() => clear, [clear])

  return { total, activeIndex, run, next, prev, clear }
}
