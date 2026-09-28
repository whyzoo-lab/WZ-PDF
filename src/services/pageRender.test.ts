import { describe, it, expect, afterEach, vi } from 'vitest'
import { getOrRenderPage, peekCachedPage, releasePage, retainPage, setPageCacheBudget } from './pageRender'
import type { ViewerDoc } from '../types/viewerDoc'

vi.mock('./openPerf', () => ({ markOpen: () => {} }))

/**
 * A document whose every page renders into a 100×100 canvas at scale 1 —
 * 40 000 bytes of raster per page, so a budget is easy to count in pages.
 */
function doc(pages = 10): ViewerDoc {
  return {
    numPages: pages,
    getPage: async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 100 * scale }),
      render: () => ({ promise: Promise.resolve() }),
    }),
  } as unknown as ViewerDoc
}

const PAGE_BYTES = 100 * 100 * 4
const cached = (d: ViewerDoc, n: number) => {
  // peek counts as a use, so compare against the cache without touching order
  return peekCachedPage(d, n) !== null
}

// jsdom canvases have no 2d context; the renderer only needs one to exist.
HTMLCanvasElement.prototype.getContext = (() => ({})) as never

afterEach(() => setPageCacheBudget())

describe('page render cache', () => {
  it('evicts the least recently used pages once over its byte budget', async () => {
    setPageCacheBudget(PAGE_BYTES * 3)
    const d = doc()
    for (const n of [1, 2, 3, 4, 5]) await getOrRenderPage(d, n, 1)
    expect([1, 2, 3, 4, 5].map(n => cached(d, n))).toEqual([false, false, true, true, true])
  })

  it('never evicts a page that is on screen', async () => {
    setPageCacheBudget(PAGE_BYTES * 2)
    const d = doc()
    retainPage(d, 1)
    for (const n of [1, 2, 3, 4]) await getOrRenderPage(d, n, 1)
    expect(cached(d, 1)).toBe(true)
    releasePage(d, 1)
  })

  it('lets a page go once it leaves the screen, if the cache is over budget', async () => {
    setPageCacheBudget(PAGE_BYTES * 2)
    const d = doc()
    for (const n of [1, 2, 3]) retainPage(d, n)
    for (const n of [1, 2, 3]) await getOrRenderPage(d, n, 1)
    expect([1, 2, 3].every(n => cached(d, n))).toBe(true) // all on screen: over budget is allowed
    releasePage(d, 1)
    expect(cached(d, 1)).toBe(false)
    releasePage(d, 2); releasePage(d, 3)
  })

  it('hands back the same canvas while the page stays cached', async () => {
    const d = doc()
    const a = await getOrRenderPage(d, 1, 1)
    const b = await getOrRenderPage(d, 1, 1)
    expect(b.canvas).toBe(a.canvas)
  })
})
