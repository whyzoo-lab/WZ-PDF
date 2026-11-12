/**
 * Make every section break that starts a new page in Word start one here.
 *
 * With `ignoreLastRenderedPageBreak: false` (so our pages are Word's pages),
 * docx-preview begins a new page only at a page-breaking element inside a
 * body paragraph's runs — an explicit break, or the `lastRenderedPageBreak`
 * Word writes where it last broke a page. A section break alone does not
 * count, and docx-preview never looks inside tables for those marks. So a
 * cover page followed by a section that opens with a table (Word puts the
 * mark in the table's first cell) came out as one page holding both sections;
 * and in a file Word never laid out, every "next page" section break was lost
 * the same way.
 *
 * This works on the model `parseAsync` returns, before `renderDocument`: the
 * paragraph that ends a section gets a page break appended — the element
 * docx-preview's own parser makes for `<w:br w:type="page"/>`, which it draws
 * as nothing — when the next section starts on a new page and docx-preview
 * would not break there anyway. Our wrapper, not a patch of the library
 * (shapes as docx-preview 0.4.1 parses them).
 */

interface Node {
  type?: string
  break?: string
  children?: Node[]
  sectionProps?: { type?: string } | null
  pageBreakBefore?: boolean
  styleName?: string
}

interface Body extends Node {
  props?: { type?: string } | null
}

interface Styles {
  findStyle?: (name: string | undefined) => { paragraphProps?: { pageBreakBefore?: boolean } } | null | undefined
}

interface Style {
  id?: string
  basedOn?: string
  paragraphProps?: { pageBreakBefore?: boolean }
}

/**
 * Look a paragraph style up as docx-preview does, following `basedOn` (it
 * merges those only while rendering, after this runs).
 */
export function styleFinder(styles: Style[] | undefined): NonNullable<Styles['findStyle']> {
  const byId = new Map((styles ?? []).filter(s => s.id).map(s => [s.id!, s]))
  return name => {
    for (let s = name ? byId.get(name) : undefined, depth = 0; s && depth < 20; s = s.basedOn ? byId.get(s.basedOn) : undefined, depth++) {
      if (s.paragraphProps?.pageBreakBefore != null) return s
    }
    return null
  }
}

/** Section types that carry on on the same page (or column). */
const SAME_PAGE = new Set(['continuous', 'nextColumn'])

const isBreak = (n: Node) =>
  n.type === 'break' && (n.break === 'page' || n.break === 'lastRenderedPageBreak')

/** Whether a run-level page break sits among `p`'s direct runs. */
function hasRunBreak(p: Node): boolean {
  return (p.children ?? []).some(r => (r.children ?? []).some(isBreak))
}

/**
 * Whether `p` breaks before any of its content, as docx-preview sees it:
 * a page break before the paragraph, or a page break in its runs ahead of any
 * text. Adding a break before such a paragraph would leave a blank page.
 */
function breaksAtStart(p: Node, styles: Styles): boolean {
  if (p.pageBreakBefore || styles.findStyle?.(p.styleName)?.paragraphProps?.pageBreakBefore) return true
  for (const run of p.children ?? []) {
    for (const child of run.children ?? []) {
      if (isBreak(child)) return true
      if (child.type === 'text' || child.type === 'tab' || child.type === 'drawing' || child.type === 'image') return false
    }
    if (run.type !== 'run') return false
  }
  return false
}

/**
 * Append a page break to each paragraph that ends a section when the next
 * section starts on a new page and nothing there would break it already.
 * Mutates `body` (docx-preview's `documentPart.body`).
 */
export function breakBetweenSections(body: Body, styles: Styles = {}): void {
  const blocks = body.children ?? []
  // A section's start type is in its own sectPr, i.e. the next one written.
  const ends = blocks
    .map((b, i) => (b.type === 'paragraph' && b.sectionProps ? i : -1))
    .filter(i => i >= 0)
  ends.forEach((at, k) => {
    const next = k + 1 < ends.length ? blocks[ends[k + 1]].sectionProps : body.props
    if (SAME_PAGE.has(next?.type ?? 'nextPage')) return
    const end = blocks[at]
    const first = blocks[at + 1]
    if (!first) return
    // docx-preview already breaks there (and splits the paragraph if the
    // mark is in the middle); a second break would be a blank page.
    if (hasRunBreak(end)) return
    if (first.type === 'paragraph' && breaksAtStart(first, styles)) return
    ;(end.children ??= []).push({ type: 'run', children: [{ type: 'break', break: 'page' }] })
  })
}
