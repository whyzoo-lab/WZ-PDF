import { useEffect, useState, type RefObject } from 'react'

/**
 * Tracks whether an element has ever entered the viewport (with rootMargin slop).
 *
 * Sticky semantics: once the element has been seen, the hook returns `true`
 * permanently — we don't want pages the user already scrolled past to unmount
 * and lose their Konva Stage (the underlying rasterized canvas is cached in
 * `usePdfPage`, but re-mounting Stages still costs ~10-30ms per page).
 *
 * Default rootMargin of 400px pre-loads the next ~half page ahead of the
 * viewport so scrolling feels instant.
 */
export function useInViewport(
  ref: RefObject<HTMLElement | null>,
  rootMargin: string = '400px',
): boolean {
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (inView) return
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, inView, rootMargin])

  return inView
}
