import { useCallback, useEffect, useRef, useState } from 'react'
import { FLOW_PRINT_ATTR } from '../services/htmlPrint'

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
 */

/** Every match. Styled in index.css via `::highlight()`. */
const HL_ALL = 'wz-find'
/** Just the current one, so it stands out from the rest. */
const HL_ACTIVE = 'wz-find-active'

/** Elements whose text must not run into the next one when matching. */
const BLOCK_SELECTOR =
  'p,div,li,tr,td,th,h1,h2,h3,h4,h5,h6,pre,blockquote,section,article,header,footer,figure,figcaption,dt,dd,br'

// The Highlight API is not in TypeScript's DOM lib yet. Declared minimally
// rather than cast away, so the two call sites stay type-checked.
type HighlightLike = { new(...ranges: Range[]): unknown }
type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void }
interface HighlightGlobals {
  CSS?: { highlights?: HighlightRegistry }
  Highlight?: HighlightLike
}

function highlightApi(): { registry: HighlightRegistry; Highlight: HighlightLike } | null {
  const g = globalThis as unknown as HighlightGlobals
  const registry = g.CSS?.highlights
  const Highlight = g.Highlight
  // Chromium 105+. Without it the search still finds and scrolls to matches,
  // it just can't paint them — a degraded find beats no find.
  return registry && Highlight ? { registry, Highlight } : null
}

interface Indexed {
  nodes: Text[]
  /** offsets[i] = start of nodes[i] within `text`. */
  offsets: number[]
  /** All text, lower-cased, with block boundaries separated by \n. */
  text: string
}

/**
 * Flatten the container's text, remembering where each node's slice starts.
 *
 * Block boundaries become "\n" so a query can't match across the gap between
 * two paragraphs — the separator carries no node, and since a query never
 * contains one, no match can straddle it.
 */
function indexText(root: HTMLElement): Indexed {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') return NodeFilter.FILTER_REJECT
      return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })

  const nodes: Text[] = []
  const offsets: number[] = []
  let text = ''
  let prevBlock: Element | null = null

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text
    const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? null
    if (nodes.length > 0 && block !== prevBlock) text += '\n'
    prevBlock = block
    nodes.push(node)
    offsets.push(text.length)
    text += node.nodeValue
  }
  return { nodes, offsets, text: text.toLowerCase() }
}

/** Index of the node whose slice contains `pos`. */
function locate(offsets: number[], pos: number): number {
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}

function rangeAt(idx: Indexed, start: number, length: number): Range | null {
  const startNode = locate(idx.offsets, start)
  const endNode = locate(idx.offsets, start + length - 1)
  try {
    const range = document.createRange()
    range.setStart(idx.nodes[startNode], start - idx.offsets[startNode])
    range.setEnd(idx.nodes[endNode], start + length - idx.offsets[endNode])
    return range
  } catch {
    // A stale index (the document re-rendered mid-search) — drop this match
    // rather than failing the whole search.
    return null
  }
}

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
    rangesRef.current = []
    setTotal(0)
    setActiveIndex(0)
    paint([], 0)
  }, [paint])

  const run = useCallback((query: string) => {
    const needle = query.trim().toLowerCase()
    const root = document.querySelector<HTMLElement>(`[${FLOW_PRINT_ATTR}]`)
    if (!enabled || !root || needle.length === 0) { clear(); return }

    const idx = indexText(root)
    const found: Range[] = []
    for (let from = 0; ; ) {
      const at = idx.text.indexOf(needle, from)
      if (at < 0) break
      const range = rangeAt(idx, at, needle.length)
      if (range) found.push(range)
      from = at + needle.length
    }

    rangesRef.current = found
    setTotal(found.length)
    setActiveIndex(0)
    paint(found, 0)
  }, [enabled, clear, paint])

  const next = useCallback(() => {
    setActiveIndex(i => (rangesRef.current.length === 0 ? 0 : (i + 1) % rangesRef.current.length))
  }, [])

  const prev = useCallback(() => {
    const n = rangesRef.current.length
    setActiveIndex(i => (n === 0 ? 0 : (i - 1 + n) % n))
  }, [])

  // Move the active highlight and bring it on screen. Not smooth-scrolled:
  // stepping through matches should land immediately, and a queued animation
  // per keypress reads as lag.
  useEffect(() => {
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
