import { useState, useRef, useLayoutEffect } from 'react'

/**
 * Collapse the toolbar into hamburger menus when its inline controls no longer
 * fit. Instead of a horizontal scrollbar (which the old layout produced on
 * narrow windows) the left/right clusters fold into dropdown menus.
 *
 * Measures the header's content width against its box; `contentKey` forces a
 * fresh re-measure whenever the set of visible controls changes (mode switch,
 * PDF load, selection…). A remembered breakpoint gives hysteresis so the bar
 * doesn't flicker around the threshold.
 */
export function useToolbarCollapse(contentKey: string) {
  const ref = useRef<HTMLElement | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const collapsedRef = useRef(false)
  const breakpoint = useRef(Infinity)

  const apply = (v: boolean) => { collapsedRef.current = v; setCollapsed(v) }

  // Sum of the inline clusters' natural widths. The header can't use
  // `overflow:hidden` (it would clip the dropdowns), and `scrollWidth` on an
  // overflow-visible flex box under-reports overflow — so we measure the
  // shrink-0 child sections directly, which keep their natural width even when
  // they overflow the bar. Only meaningful while expanded (the collapsed bar's
  // children are the compact hamburgers).
  const requiredWidth = (e: HTMLElement) => {
    let total = 0
    for (const c of Array.from(e.children)) {
      const el = c as HTMLElement
      // Absolutely positioned children take no space in the flex row, so they
      // must not be counted. The centred file name is `absolute inset-0`, whose
      // offsetWidth is the *whole bar* — adding that guaranteed the sum always
      // exceeded the width and left the toolbar permanently collapsed.
      const position = getComputedStyle(el).position
      if (position === 'absolute' || position === 'fixed') continue
      total += el.offsetWidth
    }
    return total
  }

  // Resize path — width changed. Uses a remembered breakpoint for hysteresis so
  // the bar doesn't flicker right at the threshold.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const onResize = () => {
      const e = ref.current
      if (!e) return
      if (!collapsedRef.current) {
        if (requiredWidth(e) > e.clientWidth + 1) { breakpoint.current = e.clientWidth; apply(true) }
      } else if (e.clientWidth > breakpoint.current + 24) {
        breakpoint.current = Infinity; apply(false)
      }
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Content-change path — a resize won't fire when the *content* grows/shrinks
  // (PDF load, mode switch…). If currently collapsed, drop back to the expanded
  // layout first so the measurement below sees the real content width.
  useLayoutEffect(() => {
    breakpoint.current = Infinity
    if (collapsedRef.current) apply(false)
  }, [contentKey])

  // Measure synchronously after every commit that could change fit (content or
  // the just-applied expand). rAF isn't used — it's throttled in background
  // tabs, which would leave the bar un-collapsed.
  useLayoutEffect(() => {
    const e = ref.current
    if (!e || collapsedRef.current) return
    if (requiredWidth(e) > e.clientWidth + 1) {
      breakpoint.current = e.clientWidth
      apply(true)
    }
  }, [contentKey, collapsed])

  return { ref, collapsed }
}
