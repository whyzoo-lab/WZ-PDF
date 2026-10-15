// Ctrl+wheel zooms around the pointer, the way image viewers and browsers'
// PDF viewers do. Zoom resizes every page, so without help the scroll offset
// stays put while the content grows away from it: the spot under the pointer
// slides off, and zooming into a detail of a photo meant chasing it with the
// scrollbars after every notch.
//
// The anchor is a page and a point on it as fractions of its size, not a
// scroll offset scaled by the zoom ratio: the gaps between pages and the
// padding around them do not scale, so a scaled offset drifts further the
// further down the document the pointer is.

import { PAGE_ATTR } from './constants'

export interface ZoomAnchor {
  /** The scrolling element the page lives in. */
  scroller: HTMLElement
  /** Page under the pointer; null when the pointer is between pages. */
  page: number | null
  /** The pointer's point on the page, 0–1 across and down. */
  fx: number
  fy: number
  /** Where the pointer is, in viewport coordinates. */
  x: number
  y: number
  /** Scroll position and content size, for the between-pages fallback. */
  left: number
  top: number
  width: number
  height: number
}

function scrollerOf(el: Element | null): HTMLElement | null {
  for (let n = el; n; n = n.parentElement) {
    if (!(n instanceof HTMLElement)) continue
    const s = getComputedStyle(n)
    // Not "can scroll now": a page fitted to the window cannot, and zooming in
    // is what makes it.
    if (/(auto|scroll)/.test(s.overflowY + s.overflowX)) return n
  }
  return null
}

/** What lies under the pointer at (x, y), to be kept there across a zoom. */
export function captureZoomAnchor(x: number, y: number): ZoomAnchor | null {
  const hit = document.elementFromPoint(x, y)
  const scroller = scrollerOf(hit)
  if (!scroller) return null
  const pageEl = hit?.closest(`[${PAGE_ATTR}]`)
  const base = { scroller, x, y, left: scroller.scrollLeft, top: scroller.scrollTop, width: scroller.scrollWidth, height: scroller.scrollHeight }
  if (pageEl && scroller.contains(pageEl)) {
    const r = pageEl.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      return { ...base, page: Number(pageEl.getAttribute(PAGE_ATTR)), fx: (x - r.left) / r.width, fy: (y - r.top) / r.height }
    }
  }
  return { ...base, page: null, fx: 0, fy: 0 }
}

/** Scroll so the anchored point is under the pointer again, after the zoom is laid out. */
export function restoreZoomAnchor(a: ZoomAnchor): void {
  const { scroller } = a
  if (!scroller.isConnected) return
  const pageEl = a.page === null ? null : scroller.querySelector(`[${PAGE_ATTR}="${a.page}"]`)
  if (pageEl) {
    const r = pageEl.getBoundingClientRect()
    scroller.scrollLeft += r.left + a.fx * r.width - a.x
    scroller.scrollTop += r.top + a.fy * r.height - a.y
    return
  }
  // Between pages: keep the same share of the content under the pointer.
  const box = scroller.getBoundingClientRect()
  const px = a.x - box.left, py = a.y - box.top
  if (a.width > 0) scroller.scrollLeft = (a.left + px) * (scroller.scrollWidth / a.width) - px
  if (a.height > 0) scroller.scrollTop = (a.top + py) * (scroller.scrollHeight / a.height) - py
}
