// A PDF's outline (bookmarks), with every entry resolved to a page number.
//
// pdfjs returns the tree with destinations as written in the file: a named
// destination (a string to look up) or an explicit one whose first element is
// a page reference (or, in a few writers' files, a zero-based page index).
// Resolving them once here lets the panel jump without awaiting the worker on
// every click, and shows entries that point nowhere as plain text.

export interface OutlineNode {
  title: string
  /** 1-based page, or null when the entry has no page (a link, a broken destination). */
  page: number | null
  /** A web link instead of a page. */
  url?: string
  bold?: boolean
  italic?: boolean
  children: OutlineNode[]
}

interface RawOutlineItem {
  title: string
  bold?: boolean
  italic?: boolean
  dest: string | unknown[] | null
  url: string | null
  items: RawOutlineItem[]
}

interface PdfjsOutlineApi {
  getOutline(): Promise<RawOutlineItem[] | null>
  getDestination(id: string): Promise<unknown[] | null>
  getPageIndex(ref: unknown): Promise<number>
}

/** Whether `doc` is a pdfjs document (HWP, images and the rest have no outline). */
export function hasOutline(doc: unknown): doc is PdfjsOutlineApi {
  const d = doc as Partial<PdfjsOutlineApi> | null
  return !!d && typeof d.getOutline === 'function' && typeof d.getDestination === 'function' && typeof d.getPageIndex === 'function'
}

/** Entries beyond this are dropped: an outline is for people, not a dump. */
const MAX_NODES = 5000

/** The outline with pages resolved; empty when the document has none. */
export async function loadOutline(doc: unknown): Promise<OutlineNode[]> {
  if (!hasOutline(doc)) return []
  const raw = await doc.getOutline()
  if (!raw || raw.length === 0) return []
  let budget = MAX_NODES

  const pageOf = async (dest: RawOutlineItem['dest']): Promise<number | null> => {
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
      if (!Array.isArray(explicit) || explicit.length === 0) return null
      const target = explicit[0]
      if (typeof target === 'number') return Number.isInteger(target) && target >= 0 ? target + 1 : null
      if (target && typeof target === 'object') return (await doc.getPageIndex(target)) + 1
      return null
    } catch {
      return null
    }
  }

  const build = async (items: RawOutlineItem[]): Promise<OutlineNode[]> => {
    const out: OutlineNode[] = []
    for (const it of items) {
      if (budget-- <= 0) break
      out.push({
        title: (it.title ?? '').replace(/\s+/g, ' ').trim() || '—',
        page: it.dest ? await pageOf(it.dest) : null,
        url: it.url ?? undefined,
        bold: it.bold || undefined,
        italic: it.italic || undefined,
        children: it.items?.length ? await build(it.items) : [],
      })
    }
    return out
  }
  return build(raw)
}

/** Every node in reading order, with its path ("0.2.1") as a stable id. */
export function flattenOutline(nodes: OutlineNode[], prefix = ''): { id: string; node: OutlineNode; depth: number }[] {
  const out: { id: string; node: OutlineNode; depth: number }[] = []
  nodes.forEach((node, i) => {
    const id = prefix ? `${prefix}.${i}` : String(i)
    out.push({ id, node, depth: id.split('.').length - 1 })
    out.push(...flattenOutline(node.children, id))
  })
  return out
}

/** The entry the reader is in: the last one, in reading order, starting at or before `page`. */
export function currentOutlineId(nodes: OutlineNode[], page: number): string | null {
  let best: string | null = null
  let bestPage = 0
  for (const { id, node } of flattenOutline(nodes)) {
    if (node.page !== null && node.page <= page && node.page >= bestPage) {
      best = id
      bestPage = node.page
    }
  }
  return best
}
