import { useCallback, useEffect, useRef, useState } from 'react'
import { FLOW_PRINT_ATTR } from '../services/htmlPrint'
import { findFlexible, indexText, rangeAt, type Indexed } from '../services/domText'

/**
 * Works out where the sentence being read is, as screen rectangles.
 *
 * Without this the reader is told "3 / 20" and left to find that themselves,
 * which is most of the value of reading along.
 *
 * **Why rectangles rather than the CSS Custom Highlight API.** For a reflowing
 * document that API would be ideal — the text on screen is the text. A page
 * document is different: the glyphs the reader sees are painted on a canvas,
 * and the text layer over them is an invisible stand-in whose metrics only
 * approximate them. OCR spans are the worst case — `font-size` is set to the
 * whole detected box height with no width correction — so highlighting their
 * *text* draws a band visibly wider and taller than the words, spilling past
 * the page edge. Their **boxes**, on the other hand, are the real geometry:
 * pdfjs's item box, or OCR's detected region. So the rectangles come from the
 * spans for pages and from the range for reflowing text, and a plain overlay
 * paints them — which also means nothing in the document is modified, neither
 * DOMPurify-vetted markup nor pdfjs's carefully positioned spans.
 *
 * Finding the sentence is a search rather than a stored position on purpose.
 * By the time it is spoken, wrapped lines have been joined and spaces
 * collapsed, so its offsets match nothing in the DOM while its characters still
 * do. Searching forward from the previous match keeps that linear and puts a
 * repeated sentence in the right place.
 */

/** pdfjs's text layer container — and OcrTextLayer, which reuses the class. */
const PDF_TEXT_LAYER = '.pdf-text-layer'

function flowRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${FLOW_PRINT_ATTR}]`)
}

/** Pages the reader has not reached are not mounted, so they are not searched;
 *  scrolling to follow the highlight mounts them before they are needed. */
function pageRoots(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(PDF_TEXT_LAYER))
}

/** What the rectangles are measured from, kept so they can be re-measured. */
type Target =
  | { kind: 'range'; range: Range }
  | { kind: 'spans'; spans: Element[] }

export interface SpeechRect {
  left: number
  top: number
  width: number
  height: number
}

function measure(target: Target): SpeechRect[] {
  const rects = target.kind === 'range'
    ? Array.from(target.range.getClientRects())
    : target.spans.map(span => span.getBoundingClientRect())
  return rects
    // A collapsed rect paints nothing and would only add work on every scroll.
    .filter(r => r.width > 0.5 && r.height > 0.5)
    .map(r => ({ left: r.left, top: r.top, width: r.width, height: r.height }))
}

export interface UseSpeechHighlightArgs {
  /** The sentence being spoken, or null when nothing is. */
  text: string | null
  /** Its position in the document, used to notice a restart. */
  index: number
}

export function useSpeechHighlight({ text, index }: UseSpeechHighlightArgs): SpeechRect[] {
  const [rects, setRects] = useState<SpeechRect[]>([])
  // Where the previous sentence ended: {part, offset}. Searching from here is
  // what makes the whole document a single linear scan.
  const cursorRef = useRef({ part: 0, offset: 0 })
  const lastIndexRef = useRef(-1)
  const targetRef = useRef<Target | null>(null)

  const remeasure = useCallback(() => {
    const target = targetRef.current
    setRects(target ? measure(target) : [])
  }, [])

  useEffect(() => {
    // Measured on the next frame, not in the effect body. Two reasons, and both
    // matter: a page that has just mounted has not been laid out yet, so its
    // boxes would all read as zero; and this keeps the DOM read out of React's
    // render pass.
    const frame = requestAnimationFrame(() => locate())
    return () => cancelAnimationFrame(frame)

    function locate() {
    if (!text) {
      targetRef.current = null
      setRects([])
      return
    }

    // A restart (or a jump backwards) invalidates the cursor.
    if (index <= lastIndexRef.current) cursorRef.current = { part: 0, offset: 0 }
    lastIndexRef.current = index

    const flow = flowRoot()
    const parts: { root: HTMLElement; idx: Indexed }[] = flow
      ? [{ root: flow, idx: indexText(flow) }]
      : pageRoots().map(root => ({ root, idx: indexText(root) }))

    const cursor = cursorRef.current
    // Try from where the last sentence ended, then from the beginning: the page
    // may have re-rendered (a zoom rebuilds the spans) and invalidated every
    // offset we were holding.
    for (const attempt of [cursor, { part: 0, offset: 0 }]) {
      for (let part = Math.min(attempt.part, parts.length - 1); part < parts.length; part++) {
        if (part < 0) break
        const from = part === attempt.part ? attempt.offset : 0
        const hit = findFlexible(parts[part].idx.text, text, from)
        if (!hit) continue

        const range = rangeAt(parts[part].idx, hit.start, hit.end - hit.start)
        if (!range) continue

        const target: Target = flow
          ? { kind: 'range', range }
          : { kind: 'spans', spans: Array.from(parts[part].root.children)
              .filter(el => range.intersectsNode(el)) }
        if (target.kind === 'spans' && target.spans.length === 0) continue

        targetRef.current = target
        const measured = measure(target)
        setRects(measured)
        cursorRef.current = { part, offset: hit.end }

        // `nearest` rather than `center`: the reader is following along, and
        // yanking the page on every sentence is worse than letting it sit still
        // until the highlight would otherwise leave the screen.
        const anchor = target.kind === 'range'
          ? range.startContainer.parentElement
          : target.spans[0]
        anchor?.scrollIntoView({ block: 'nearest' })
        return
      }
    }
    // Not found — the page it lives on is probably not mounted yet. Leaving the
    // last rectangles up would point at the wrong sentence.
    targetRef.current = null
    setRects([])
    }
  }, [text, index])

  // The rectangles are viewport coordinates, so anything that moves the
  // document invalidates them. Measured on a frame so a scroll does not force
  // a layout per event.
  useEffect(() => {
    if (rects.length === 0) return
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; remeasure() })
    }
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [rects.length, remeasure])

  return rects
}
