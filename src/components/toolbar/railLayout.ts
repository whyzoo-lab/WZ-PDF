// The arithmetic of a rail: how many items fit before the rest go into "...",
// and the room there is to fit them in. Kept apart from the components so
// fast refresh can treat rail.tsx as components only.

import { useEffect, useState } from 'react'
import type { RailAxis } from './rail'

/**
 * How many of the items (each `sizes[i]` px along the rail, separators
 * included) fit in `available` px. When not all do, room is kept for the
 * overflow button (`moreSize`), so it never pushes the last shown item out.
 */
export function itemsThatFit(sizes: number[], available: number, moreSize: number): number {
  const total = sizes.reduce((s, x) => s + x, 0)
  if (total <= available) return sizes.length
  let used = moreSize, n = 0
  while (n < sizes.length && used + sizes[n] <= available) used += sizes[n++]
  return n
}

/**
 * The room along a rail's axis for its scrolling items, measured on a
 * container that fills the space between the rail's fixed ends. Infinity
 * until measured (and where ResizeObserver is missing, as in tests): every
 * item shows.
 */
export function useRailRoom(axis: RailAxis): { ref: (el: HTMLElement | null) => void; room: number } {
  const [room, setRoom] = useState(Infinity)
  const [el, setEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setRoom(axis === 'column' ? el.clientHeight : el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [el, axis])
  return { ref: setEl, room }
}
