// Page operations on an image collection — the same four the page list offers
// for a PDF (delete, reorder, insert blank, insert more), done on the list of
// entries rather than on PDF bytes. Each returns the new entry list and the
// old → new page mapping that `remapAnnotations` uses, in the shape
// pdfPageService returns for a PDF, so stamps follow their pictures.

import type { ImageSetEntry } from '../types/viewerDoc'

export interface EntriesResult { entries: ImageSetEntry[]; pageMapping: Map<number, number> }

export function deleteEntries(entries: ImageSetEntry[], pageNums: number[]): EntriesResult {
  const gone = new Set(pageNums)
  const kept: ImageSetEntry[] = []
  const pageMapping = new Map<number, number>()
  entries.forEach((e, i) => {
    if (gone.has(i + 1)) return
    kept.push(e)
    pageMapping.set(i + 1, kept.length)
  })
  if (kept.length === 0) throw new Error('At least one page must remain')
  return { entries: kept, pageMapping }
}

/** `newOrder` lists old page numbers in their new order. */
export function reorderEntries(entries: ImageSetEntry[], newOrder: number[]): EntriesResult {
  if (newOrder.length !== entries.length || new Set(newOrder).size !== entries.length) {
    throw new Error('Invalid page order')
  }
  const pageMapping = new Map<number, number>()
  const reordered = newOrder.map((old, i) => {
    const e = entries[old - 1]
    if (!e) throw new Error('Invalid page order')
    pageMapping.set(old, i + 1)
    return e
  })
  return { entries: reordered, pageMapping }
}

/** Put `added` after page `afterPage` (0 = before the first). */
export function insertEntries(entries: ImageSetEntry[], afterPage: number, added: ImageSetEntry[]): EntriesResult {
  const at = Math.max(0, Math.min(afterPage, entries.length))
  const pageMapping = new Map<number, number>()
  entries.forEach((_, i) => pageMapping.set(i + 1, i + 1 <= at ? i + 1 : i + 1 + added.length))
  return { entries: [...entries.slice(0, at), ...added, ...entries.slice(at)], pageMapping }
}
