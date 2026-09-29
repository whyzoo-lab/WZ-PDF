/**
 * How two-page view groups pages into rows.
 *
 * It used to be a fixed 1-2, 3-4, … which put a landscape page (an A3 drawing,
 * an A4 table turned sideways) beside a portrait A4 — the pair then no longer
 * fits the fit-to-two-pages zoom, and the wide page is shrunk to a strip beside
 * its neighbour. A page noticeably wider than the document's usual shape now
 * gets a row of its own, and pairing starts again after it.
 */

export interface PageSize { width: number; height: number }

/**
 * A page is shown alone when its width-to-height ratio exceeds the document's
 * typical ratio by this much. A4 landscape against A4 portrait is 2x; Letter
 * among A4 is ~1.1x and stays paired.
 */
export const WIDE_PAGE_FACTOR = 1.25

function aspect(size: PageSize, rotation: number): number {
  const turned = rotation === 90 || rotation === 270
  return turned ? size.height / size.width : size.width / size.height
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Pages grouped into rows of one or two, 1-based.
 *
 * "Wide" is relative to the document itself (its median shape), so a deck of
 * landscape slides still pairs normally; and it must be landscape as displayed,
 * since a page that is merely less tall than its neighbours is not what makes a
 * pair too wide. Without sizes (still loading) it falls back to plain pairs.
 */
export function buildSpreads(numPages: number, sizes: readonly (PageSize | undefined)[] | null, rotation = 0): number[][] {
  const known = sizes ? sizes.filter((s): s is PageSize => !!s && s.width > 0 && s.height > 0) : []
  const typical = known.length > 0 ? median(known.map(s => aspect(s, rotation))) : 0
  const isWide = (page: number): boolean => {
    const size = sizes?.[page - 1]
    if (!size || typical === 0) return false
    const a = aspect(size, rotation)
    return a > 1 && a > typical * WIDE_PAGE_FACTOR
  }

  const spreads: number[][] = []
  let pending: number | null = null
  for (let page = 1; page <= numPages; page++) {
    if (isWide(page)) {
      if (pending !== null) { spreads.push([pending]); pending = null }
      spreads.push([page])
    } else if (pending === null) {
      pending = page
    } else {
      spreads.push([pending, page])
      pending = null
    }
  }
  if (pending !== null) spreads.push([pending])
  return spreads
}

/** Index of the row holding `page`; the last row for anything past the end. */
export function spreadIndexOf(spreads: readonly number[][], page: number): number {
  const i = spreads.findIndex(s => s.includes(page))
  if (i >= 0) return i
  return page < 1 ? 0 : Math.max(0, spreads.length - 1)
}
