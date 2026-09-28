import { useEffect, useRef, useState, type RefObject } from 'react'

interface InViewportOptions {
  /** How close to the viewport the element must come to count as in view. */
  mountMargin?: string
  /**
   * How far it must then move away to count as out of view again — much wider
   * than `mountMargin`, so a page does not flip in and out at the boundary.
   */
  keepMargin?: string
  /** Called just before the element counts as out of view, while it is still laid out. */
  onLeave?: () => void
}

/**
 * Whether an element is in or near the viewport.
 *
 * Two-sided. It used to be sticky — once seen, true for good — so every page a
 * reader had scrolled past kept its Konva stage and canvases: a long document
 * read to the end held every page at once (~10 MB per A4 page at fit-page,
 * ~60 MB at fit-width). Now a page comes in within `mountMargin` (the next
 * ~half page, so scrolling feels instant) and goes out only past
 * `keepMargin` (two screens away). Remounting is cheap: the raster comes back
 * from the render cache.
 */
export function useInViewport(
  ref: RefObject<HTMLElement | null>,
  { mountMargin = '400px', keepMargin = '200% 0px', onLeave }: InViewportOptions = {},
): boolean {
  const [inView, setInView] = useState(false)
  const leave = useRef(onLeave)
  useEffect(() => { leave.current = onLeave })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      entries => {
        const near = entries.some(e => e.isIntersecting)
        if (!inView && near) setInView(true)
        else if (inView && !near) {
          leave.current?.()
          setInView(false)
        }
      },
      { rootMargin: inView ? keepMargin : mountMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, inView, mountMargin, keepMargin])

  return inView
}
