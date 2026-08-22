/**
 * Flattening live DOM into searchable text, and turning positions in that text
 * back into `Range` objects.
 *
 * Shared by find-in-document (`useFlowSearch`) and read-aloud highlighting
 * (`useSpeechHighlight`). Both need the same thing for the same reason: the
 * documents involved — sanitized mail and Markdown, and pdfjs's text layer —
 * are DOM we must not rewrite. Wrapping matches in `<mark>` would mean editing
 * vetted HTML on every keystroke, and rebuilding pdfjs's spans would break the
 * alignment that makes them selectable. `Range` plus the CSS Custom Highlight
 * API paints over the document without touching it.
 */

/**
 * Marks a block boundary in the flattened text.
 *
 * Not a newline, which would be ambiguous: a newline also occurs *inside* a
 * text node — `<p>줄이\n나뉜 문장</p>` is one paragraph however the markup is
 * indented — and a sentence the speech pipeline joined into one line has to
 * match across that. A control character no document contains keeps the two
 * cases apart: this one is a hard barrier, whitespace inside a node is not.
 */
export const BLOCK_SEPARATOR = '\u001f'

/** Elements whose text must not run into the next one when matching. */
const BLOCK_SELECTOR =
  'p,div,li,tr,td,th,h1,h2,h3,h4,h5,h6,pre,blockquote,section,article,header,footer,figure,figcaption,dt,dd,br'

// The Highlight API is not in TypeScript's DOM lib yet. Declared minimally
// rather than cast away, so call sites stay type-checked.
type HighlightLike = { new(...ranges: Range[]): unknown }
type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void }
interface HighlightGlobals {
  CSS?: { highlights?: HighlightRegistry }
  Highlight?: HighlightLike
}

export function highlightApi(): { registry: HighlightRegistry; Highlight: HighlightLike } | null {
  const g = globalThis as unknown as HighlightGlobals
  const registry = g.CSS?.highlights
  const Highlight = g.Highlight
  // Chromium 105+. Without it callers still work, they just cannot paint —
  // a degraded find (or an unhighlighted read-aloud) beats neither working.
  return registry && Highlight ? { registry, Highlight } : null
}

export interface Indexed {
  nodes: Text[]
  /** offsets[i] = start of nodes[i] within `text`. */
  offsets: number[]
  /** All text, with block boundaries marked by BLOCK_SEPARATOR. */
  text: string
}

/**
 * Flatten the container's text, remembering where each node's slice starts.
 *
 * Block boundaries become BLOCK_SEPARATOR so nothing can match across the gap
 * between two paragraphs — it belongs to no node, and since neither a search
 * query nor a spoken sentence ever contains one, no match can straddle it.
 */
export function indexText(root: HTMLElement): Indexed {
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
    if (nodes.length > 0 && block !== prevBlock) text += BLOCK_SEPARATOR
    prevBlock = block
    nodes.push(node)
    offsets.push(text.length)
    text += node.nodeValue
  }
  return { nodes, offsets, text }
}

/** Index of the node whose slice contains `pos`. */
export function locate(offsets: number[], pos: number): number {
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function rangeAt(idx: Indexed, start: number, length: number): Range | null {
  if (length <= 0 || idx.nodes.length === 0) return null
  const startNode = locate(idx.offsets, start)
  const endNode = locate(idx.offsets, start + length - 1)
  try {
    const range = document.createRange()
    range.setStart(idx.nodes[startNode], start - idx.offsets[startNode])
    range.setEnd(idx.nodes[endNode], start + length - idx.offsets[endNode])
    return range
  } catch {
    // A stale index (the document re-rendered mid-search) — drop this match
    // rather than failing everything.
    return null
  }
}

/**
 * Find `needle` in flattened DOM text, ignoring how whitespace is written.
 *
 * Needed because the text being looked for has been through the read-aloud
 * pipeline: wrapped lines were joined, runs of spaces collapsed, non-breaking
 * spaces folded. The characters survive that; the spacing does not. Comparing
 * only non-whitespace characters, and letting whitespace on either side match
 * freely, finds the sentence where a literal `indexOf` never would.
 *
 * `from` is where to start looking. Callers pass the end of the previous match,
 * which is what keeps a sentence that occurs twice highlighting in the right
 * place — and makes the whole scan linear over the document rather than
 * quadratic.
 */
export function findFlexible(
  haystack: string,
  needle: string,
  from = 0,
): { start: number; end: number } | null {
  const isSpace = (ch: string) => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r'
    || ch === '\u00a0'

  // Compare only the characters that carry meaning.
  const target = [...needle].filter(ch => !isSpace(ch))
  if (target.length === 0) return null

  for (let start = from; start <= haystack.length - target.length; start++) {
    if (isSpace(haystack[start])) continue
    if (haystack[start] !== target[0]) continue

    let h = start
    let t = 0
    while (t < target.length && h < haystack.length) {
      // A block boundary ends the candidate: no sentence spans two paragraphs,
      // and letting one appear to would highlight the wrong text entirely.
      if (haystack[h] === BLOCK_SEPARATOR) break
      if (isSpace(haystack[h])) { h++; continue }
      if (haystack[h] !== target[t]) break
      h++
      t++
    }
    if (t === target.length) return { start, end: h }
  }
  return null
}
