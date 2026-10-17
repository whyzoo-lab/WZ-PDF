// Matching for find (Ctrl+F), shared by page documents (useSearch) and the
// reflowing ones (useFlowSearch).
//
// After PdfCraft's search (crates/render/src/text/search.rs, Apache-2.0/MIT),
// which folds case and collapses whitespace before matching so a phrase is
// found across a line break. Here that is one regular expression over the
// original text, so the positions it returns need no mapping back: a space in
// the query matches any run of whitespace (a line end in a PDF is given one,
// see useSearch), case folds the Unicode way unless asked not to, and a
// whole-word search requires no letter or digit on either side.

export interface FindOptions {
  caseSensitive: boolean
  wholeWord: boolean
}

export const DEFAULT_FIND_OPTIONS: FindOptions = { caseSensitive: false, wholeWord: false }

/** The pattern for a query, or null when there is nothing to look for. */
export function findPattern(query: string, opts: FindOptions = DEFAULT_FIND_OPTIONS): RegExp | null {
  const q = query.trim()
  if (!q) return null
  const body = q.split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
  const src = opts.wholeWord ? `(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])` : body
  return new RegExp(src, opts.caseSensitive ? 'gu' : 'giu')
}

/** Every match of `query` in `text`, as [start, end) character offsets. */
export function findAll(text: string, query: string, opts: FindOptions = DEFAULT_FIND_OPTIONS): [number, number][] {
  const re = findPattern(query, opts)
  if (!re) return []
  const out: [number, number][] = []
  for (const m of text.matchAll(re)) {
    if (m[0].length === 0) continue
    out.push([m.index, m.index + m[0].length])
  }
  return out
}

export interface Snippet {
  before: string
  hit: string
  after: string
}

/** A line of context around a match, for the results list. */
export function snippetAt(text: string, start: number, end: number, radius = 32): Snippet {
  // Whitespace and the DOM index's block marks (U+001F) read as one space.
  const clean = (s: string) => s.split(String.fromCharCode(0x1f)).join(' ').replace(/\s+/g, ' ')
  const from = Math.max(0, start - radius)
  const to = Math.min(text.length, end + radius)
  return {
    before: (from > 0 ? '…' : '') + clean(text.slice(from, start)).trimStart(),
    hit: clean(text.slice(start, end)),
    after: clean(text.slice(end, to)).trimEnd() + (to < text.length ? '…' : ''),
  }
}
