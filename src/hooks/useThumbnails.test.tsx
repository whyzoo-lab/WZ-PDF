import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { useRef } from 'react'
import { THUMB_PAGE_ATTR, useThumbnails } from './useThumbnails'
import type { ViewerDoc } from '../types/viewerDoc'

vi.mock('../services/pageRender', () => ({ peekCachedPage: () => null }))

// jsdom has no layout, so the observer is driven by hand: `show(pages)` reports
// those rows as in view, as the browser would when the list scrolls to them.
let observed: Element[] = []
let callback: IntersectionObserverCallback = () => {}
class FakeObserver {
  constructor(cb: IntersectionObserverCallback) { callback = cb }
  observe(el: Element) { observed.push(el) }
  disconnect() { observed = [] }
}
function show(pages: number[]) {
  const entries = observed.map(target => ({
    target, isIntersecting: pages.includes(Number(target.getAttribute(THUMB_PAGE_ATTR))),
  }))
  act(() => { callback(entries as never, {} as never) })
}

function doc(numPages: number) {
  const rendered: number[] = []
  const d = {
    numPages,
    getPage: async (n: number) => ({
      getViewport: () => ({ width: 60, height: 80 }),
      render: () => { rendered.push(n); return { promise: Promise.resolve() } },
    }),
  } as unknown as ViewerDoc
  return { d, rendered }
}

function Panel({ d, n }: { d: ViewerDoc; n: number }) {
  const listRef = useRef<HTMLDivElement>(null)
  const thumbnailOf = useThumbnails(d, n, listRef)
  return (
    <div ref={listRef}>
      {Array.from({ length: n }, (_, i) => i + 1).map(p => (
        <div key={p} {...{ [THUMB_PAGE_ATTR]: p }}>{thumbnailOf(p) ? `thumb-${p}` : `pending-${p}`}</div>
      ))}
    </div>
  )
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AA'
})
afterEach(() => { vi.unstubAllGlobals() })

describe('useThumbnails', () => {
  it('renders only the rows that are in view, not the whole document', async () => {
    const { d, rendered } = doc(200)
    const { container } = render(<Panel d={d} n={200} />)
    show([1, 2, 3])
    await waitFor(() => expect(container.textContent).toContain('thumb-3'))
    expect(rendered.sort((a, b) => a - b)).toEqual([1, 2, 3])
    expect(container.textContent).toContain('pending-4')
  })

  it('keeps finished thumbnails when the panel is closed and opened again', async () => {
    const { d, rendered } = doc(10)
    const first = render(<Panel d={d} n={10} />)
    show([1, 2])
    await waitFor(() => expect(first.container.textContent).toContain('thumb-2'))
    first.unmount()
    const again = render(<Panel d={d} n={10} />)
    expect(again.container.textContent).toContain('thumb-1')
    show([1, 2])
    await new Promise(r => setTimeout(r, 20))
    expect(rendered.sort((a, b) => a - b)).toEqual([1, 2])
  })
})
