import { useState, useCallback, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

/**
 * A single search hit. `itemStart`/`itemEnd` are indices into the page's
 * pdfjs text-content items (which map 1:1, in order, to the spans the text
 * layer renders) — the highlighter uses them to background the matched spans.
 */
export interface SearchMatch {
  page: number
  itemStart: number
  itemEnd: number
}

interface PageText {
  /** Per-item strings, in render order. */
  items: string[]
  /** All item strings concatenated (lower-cased) for matching. */
  concat: string
  /** offsets[i] = start char index of item i within `concat`. */
  offsets: number[]
}

export interface UseSearchReturn {
  query: string
  matches: SearchMatch[]
  activeIndex: number
  isSearching: boolean
  /** Run a search across the whole document. Empty query clears results. */
  run: (query: string) => Promise<void>
  next: () => void
  prev: () => void
  clear: () => void
  /** The currently-active match, or null. */
  active: SearchMatch | null
}

export function useSearch(
  pdfDoc: PDFDocumentProxy | null,
  numPages: number,
  ocrProvider?: (page: number) => string[] | undefined,
): UseSearchReturn {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [isSearching, setIsSearching] = useState(false)

  // Per-document cache of extracted page text. Cleared when the doc changes.
  const cacheRef = useRef<{ doc: PDFDocumentProxy | null; pages: Map<number, PageText> }>({
    doc: null,
    pages: new Map(),
  })
  // Guards against out-of-order async completions (fast typing).
  const runIdRef = useRef(0)

  const getPageText = useCallback(async (doc: PDFDocumentProxy, page: number): Promise<PageText> => {
    if (cacheRef.current.doc !== doc) {
      cacheRef.current = { doc, pages: new Map() }
    }
    const hit = cacheRef.current.pages.get(page)
    if (hit && !(hit.concat.length === 0 && ocrProvider?.(page)?.length)) return hit

    const pg = await doc.getPage(page)
    const content = await pg.getTextContent()
    let items = content.items.map(it => ('str' in it ? it.str : ''))
    // Scanned page (no pdfjs text) → use OCR words if available.
    if (items.join('').trim().length === 0) {
      const ocrItems = ocrProvider?.(page)
      if (ocrItems && ocrItems.length > 0) items = ocrItems
    }
    const offsets: number[] = []
    let concat = ''
    for (const s of items) {
      offsets.push(concat.length)
      concat += s
    }
    const result: PageText = { items, concat: concat.toLowerCase(), offsets }
    cacheRef.current.pages.set(page, result)
    return result
  }, [ocrProvider])

  const run = useCallback(async (q: string) => {
    setQuery(q)
    const needle = q.trim().toLowerCase()
    if (!pdfDoc || needle.length === 0) {
      setMatches([])
      setActiveIndex(0)
      setIsSearching(false)
      return
    }

    const myRun = ++runIdRef.current
    setIsSearching(true)
    const found: SearchMatch[] = []

    for (let page = 1; page <= numPages; page++) {
      // Bail if a newer search superseded this one.
      if (runIdRef.current !== myRun) return
      let pt: PageText
      try {
        pt = await getPageText(pdfDoc, page)
      } catch {
        continue
      }
      let from = 0
      while (true) {
        const idx = pt.concat.indexOf(needle, from)
        if (idx < 0) break
        const end = idx + needle.length
        // Map [idx, end) char range → item index range.
        let itemStart = 0
        let itemEnd = 0
        for (let i = 0; i < pt.offsets.length; i++) {
          if (pt.offsets[i] <= idx) itemStart = i
          if (pt.offsets[i] < end) itemEnd = i
        }
        found.push({ page, itemStart, itemEnd })
        from = end
      }
    }

    if (runIdRef.current !== myRun) return
    setMatches(found)
    setActiveIndex(0)
    setIsSearching(false)
  }, [pdfDoc, numPages, getPageText])

  const next = useCallback(() => {
    setActiveIndex(i => (matches.length === 0 ? 0 : (i + 1) % matches.length))
  }, [matches.length])

  const prev = useCallback(() => {
    setActiveIndex(i => (matches.length === 0 ? 0 : (i - 1 + matches.length) % matches.length))
  }, [matches.length])

  const clear = useCallback(() => {
    runIdRef.current++
    setQuery('')
    setMatches([])
    setActiveIndex(0)
    setIsSearching(false)
  }, [])

  return {
    query,
    matches,
    activeIndex,
    isSearching,
    run,
    next,
    prev,
    clear,
    active: matches[activeIndex] ?? null,
  }
}
