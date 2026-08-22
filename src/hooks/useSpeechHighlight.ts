import { useCallback, useEffect, useRef } from 'react'
import { FLOW_PRINT_ATTR } from '../services/htmlPrint'
import { findFlexible, highlightApi, indexText, rangeAt, type Indexed } from '../services/domText'

/**
 * Shows which sentence is being read.
 *
 * Without it the reader is told "3 / 20" and left to work out where that is,
 * which is most of the value of reading along. It paints through the CSS Custom
 * Highlight API for the same reason find does: both the sanitized mail /
 * Markdown body and pdfjs's text layer are DOM we must not rewrite — pdfjs's
 * spans in particular are positioned to line up with the painted glyphs, and
 * wrapping them in elements would break the alignment that makes them
 * selectable.
 *
 * Finding the sentence is a search rather than a stored position on purpose.
 * The text has been through the speech pipeline — wrapped lines joined, spaces
 * collapsed — so its offsets no longer correspond to anything in the DOM, while
 * its characters still do. Searching forward from the previous match keeps that
 * cheap and puts a repeated sentence in the right place.
 */

/** Styled in index.css via `::highlight()`. */
const HL_SPEAK = 'wz-speak'

/** pdfjs's text layer container, one per rendered page. */
const PDF_TEXT_LAYER = '.pdf-text-layer'

interface Roots {
  /** Indexed text of each root, in document order. */
  parts: { root: HTMLElement; idx: Indexed }[]
}

function collectRoots(): Roots {
  const flow = document.querySelector<HTMLElement>(`[${FLOW_PRINT_ATTR}]`)
  if (flow) return { parts: [{ root: flow, idx: indexText(flow) }] }

  // Page documents: every mounted text layer, in page order. Pages the reader
  // has not reached yet are not mounted, so they simply are not searched —
  // scrolling to follow the highlight mounts them before they are needed.
  const layers = Array.from(document.querySelectorAll<HTMLElement>(PDF_TEXT_LAYER))
  return { parts: layers.map(root => ({ root, idx: indexText(root) })) }
}

export interface UseSpeechHighlightArgs {
  /** The sentence being spoken, or null when nothing is. */
  text: string | null
  /** Its position in the document, used to notice a restart. */
  index: number
}

export function useSpeechHighlight({ text, index }: UseSpeechHighlightArgs): void {
  // Where the previous sentence ended: {part, offset}. Searching from here is
  // what makes the whole document a single linear scan.
  const cursorRef = useRef({ part: 0, offset: 0 })
  const lastIndexRef = useRef(-1)

  const clear = useCallback(() => {
    highlightApi()?.registry.delete(HL_SPEAK)
  }, [])

  useEffect(() => {
    if (!text) { clear(); return }

    // A restart (or a jump backwards) invalidates the cursor.
    if (index <= lastIndexRef.current) cursorRef.current = { part: 0, offset: 0 }
    lastIndexRef.current = index

    const api = highlightApi()
    if (!api) return

    const { parts } = collectRoots()
    if (parts.length === 0) { clear(); return }

    const cursor = cursorRef.current
    // Try from where the last sentence ended, then from the beginning: the
    // page may have re-rendered (a zoom rebuilds pdfjs's spans) and invalidated
    // every offset we were holding.
    for (const attempt of [cursor, { part: 0, offset: 0 }]) {
      for (let part = Math.min(attempt.part, parts.length - 1); part < parts.length; part++) {
        const from = part === attempt.part ? attempt.offset : 0
        const hit = findFlexible(parts[part].idx.text, text, from)
        if (!hit) continue

        const range = rangeAt(parts[part].idx, hit.start, hit.end - hit.start)
        if (!range) continue

        api.registry.set(HL_SPEAK, new api.Highlight(range))
        cursorRef.current = { part, offset: hit.end }
        // `nearest` rather than `center`: the reader is following along, and
        // yanking the page on every sentence is worse than letting it sit
        // still until the highlight would otherwise leave the screen.
        range.startContainer.parentElement?.scrollIntoView({ block: 'nearest' })
        return
      }
    }
    // Not found — the page it lives on is probably not mounted yet. Leaving the
    // previous highlight up would point at the wrong sentence, so clear it.
    clear()
  }, [text, index, clear])

  // The registry is global, so a highlight must not outlive the component.
  useEffect(() => clear, [clear])
}
