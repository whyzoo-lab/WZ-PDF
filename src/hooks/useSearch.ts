import { useState, useCallback, useRef, useLayoutEffect } from 'react'
import type { ViewerDoc } from '../types/viewerDoc'
import { DEFAULT_FIND_OPTIONS, findAll, snippetAt, type FindOptions, type Snippet } from '../services/textSearch'

/**
 * A single search hit. `itemStart`/`itemEnd` are indices into the page's
 * pdfjs text-content items (which map 1:1, in order, to the spans the text
 * layer renders) — the highlighter uses them to background the matched spans.
 */
export interface SearchMatch {
  page: number
  itemStart: number
  itemEnd: number
  /** A line of context, for the results list. */
  snippet?: Snippet
}

interface PageText {
  /** All item strings concatenated, a newline after an item that ends a line. */
  text: string
  /** offsets[i] = start char index of item i within `text`. */
  offsets: number[]
}

export interface UseSearchReturn {
  query: string
  matches: SearchMatch[]
  activeIndex: number
  isSearching: boolean
  /** Pages searched so far, while a search runs. */
  progress: { done: number; total: number } | null
  options: FindOptions
  /** Change case / whole-word and search again. */
  setOptions: (options: FindOptions) => void
  /** Run a search across the whole document. Empty query clears results. */
  run: (query: string) => Promise<void>
  next: () => void
  prev: () => void
  /** Make match `index` the current one (the results list). */
  select: (index: number) => void
  clear: () => void
  /** The currently-active match, or null. */
  active: SearchMatch | null
}

/** How often results found so far are shown while a search runs. */
const FLUSH_MS = 120

/**
 * Find in a page document.
 *
 * After PdfCraft's find bar (Apache-2.0/MIT): results appear while the search
 * runs, "3 / 16+" until it is done, and it starts at the page in view — the
 * first match shown is the first one at or after where the reader is, not the
 * first in the document. A phrase is found across a line break (each line end
 * is a newline here, which a space in the query matches), and case and whole
 * words are options (services/textSearch.ts).
 */
export function useSearch(
  pdfDoc: ViewerDoc | null,
  numPages: number,
  ocrProvider?: (page: number) => string[] | undefined,
  currentPage = 1,
): UseSearchReturn {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [isSearching, setIsSearching] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [options, setOptionsState] = useState<FindOptions>(DEFAULT_FIND_OPTIONS)
  const optionsRef = useRef(options)
  const queryRef = useRef('')
  const pageRef = useRef(currentPage)
  useLayoutEffect(() => { pageRef.current = currentPage })

  // Per-document cache of extracted page text. Cleared when the doc changes.
  const cacheRef = useRef<{ doc: ViewerDoc | null; pages: Map<number, PageText> }>({
    doc: null,
    pages: new Map(),
  })
  // Guards against out-of-order async completions (fast typing).
  const runIdRef = useRef(0)

  const getPageText = useCallback(async (doc: ViewerDoc, page: number): Promise<PageText> => {
    if (cacheRef.current.doc !== doc) {
      cacheRef.current = { doc, pages: new Map() }
    }
    const hit = cacheRef.current.pages.get(page)
    if (hit && !(hit.text.trim().length === 0 && ocrProvider?.(page)?.length)) return hit

    const pg = await doc.getPage(page)
    const content = await pg.getTextContent()
    // String items only. Marked-content markers (`beginMarkedContent` …) have no
    // `str`, and pdfjs's TextLayer creates no text element for them — counting
    // them as '' put every later match index past the element it names, so the
    // highlight and the scroll landed on the wrong words (or on nothing).
    let items = content.items
      .filter(it => it && typeof it === 'object' && 'str' in it)
      .map(it => it as { str: string; hasEOL?: boolean })
    // Scanned page (no pdfjs text) → use OCR words if available, a space after each.
    if (items.every(it => it.str.trim().length === 0)) {
      const ocrItems = ocrProvider?.(page)
      if (ocrItems && ocrItems.length > 0) items = ocrItems.map(str => ({ str, hasEOL: true }))
    }
    const offsets: number[] = []
    let text = ''
    for (const it of items) {
      offsets.push(text.length)
      text += it.str
      // A line end counts as whitespace, so a phrase is found across it. The
      // character belongs to the item before it.
      if (it.hasEOL) text += '\n'
    }
    const result: PageText = { text, offsets }
    cacheRef.current.pages.set(page, result)
    return result
  }, [ocrProvider])

  const run = useCallback(async (q: string) => {
    setQuery(q)
    queryRef.current = q
    const opts = optionsRef.current
    if (!pdfDoc || q.trim().length === 0) {
      runIdRef.current++
      setMatches([])
      setActiveIndex(0)
      setIsSearching(false)
      setProgress(null)
      return
    }

    const myRun = ++runIdRef.current
    setIsSearching(true)
    setMatches([])
    setActiveIndex(0)
    setProgress({ done: 0, total: numPages })

    // From the page in view to the end, then from the start up to it. Matches
    // before it go in front, so the list stays in page order and the current
    // match (index 0 of what follows) moves along as they arrive.
    const start = Math.min(Math.max(1, pageRef.current), Math.max(1, numPages))
    const order: number[] = []
    for (let p = start; p <= numPages; p++) order.push(p)
    for (let p = 1; p < start; p++) order.push(p)
    const head: SearchMatch[] = []
    const tail: SearchMatch[] = []
    let shownHead = 0
    let lastFlush = performance.now()
    const flush = (done: number) => {
      const added = head.length - shownHead
      shownHead = head.length
      setMatches(head.concat(tail))
      if (added > 0) setActiveIndex(i => i + added)
      setProgress(done < order.length ? { done, total: order.length } : null)
    }

    for (let k = 0; k < order.length; k++) {
      // Bail if a newer search superseded this one.
      if (runIdRef.current !== myRun) return
      const page = order[k]
      let pt: PageText
      try {
        pt = await getPageText(pdfDoc, page)
      } catch {
        continue
      }
      if (runIdRef.current !== myRun) return
      // Map each [start, end) char range → item index range. Matches come in
      // increasing order, so the two cursors only ever move forward: one pass
      // over the items per page.
      const { offsets } = pt
      const into = page >= start ? tail : head
      let itemStart = 0
      let itemEnd = 0
      for (const [s, e] of findAll(pt.text, q, opts)) {
        while (itemStart + 1 < offsets.length && offsets[itemStart + 1] <= s) itemStart++
        if (itemEnd < itemStart) itemEnd = itemStart
        while (itemEnd + 1 < offsets.length && offsets[itemEnd + 1] < e) itemEnd++
        into.push({ page, itemStart, itemEnd, snippet: snippetAt(pt.text, s, e) })
      }
      if (performance.now() - lastFlush > FLUSH_MS) {
        flush(k + 1)
        lastFlush = performance.now()
      }
    }

    if (runIdRef.current !== myRun) return
    flush(order.length)
    setIsSearching(false)
  }, [pdfDoc, numPages, getPageText])

  const setOptions = useCallback((next: FindOptions) => {
    optionsRef.current = next
    setOptionsState(next)
    if (queryRef.current.trim()) void run(queryRef.current)
  }, [run])

  const next = useCallback(() => {
    setActiveIndex(i => (matches.length === 0 ? 0 : (i + 1) % matches.length))
  }, [matches.length])

  const prev = useCallback(() => {
    setActiveIndex(i => (matches.length === 0 ? 0 : (i - 1 + matches.length) % matches.length))
  }, [matches.length])

  const select = useCallback((index: number) => {
    setActiveIndex(i => (index >= 0 && index < matches.length ? index : i))
  }, [matches.length])

  const clear = useCallback(() => {
    runIdRef.current++
    queryRef.current = ''
    setQuery('')
    setMatches([])
    setActiveIndex(0)
    setIsSearching(false)
    setProgress(null)
  }, [])

  return {
    query,
    matches,
    activeIndex,
    isSearching,
    progress,
    options,
    setOptions,
    run,
    next,
    prev,
    select,
    clear,
    active: matches[activeIndex] ?? null,
  }
}
