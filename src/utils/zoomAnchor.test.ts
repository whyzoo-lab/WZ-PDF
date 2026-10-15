import { describe, it, expect, afterEach, vi } from 'vitest'
import { captureZoomAnchor, restoreZoomAnchor } from './zoomAnchor'
import { PAGE_ATTR } from './constants'

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

/** A scroller at the viewport's origin holding page 3, laid out by `layout`. */
function setup() {
  const scroller = document.createElement('div')
  scroller.style.overflowY = 'auto'
  const page = document.createElement('div')
  page.setAttribute(PAGE_ATTR, '3')
  scroller.appendChild(page)
  document.body.appendChild(scroller)
  // Page 3 starts 1000 px down the content and 100 px in; `size` is its width
  // and height. Its viewport position follows the scroller's scroll offsets.
  let size = 500
  const layout = (s: number) => { size = s }
  page.getBoundingClientRect = () => rect(100 - scroller.scrollLeft, 1000 - scroller.scrollTop, size, size)
  scroller.getBoundingClientRect = () => rect(0, 0, 800, 600)
  // jsdom does no layout: scroll offsets are plain numbers here.
  for (const k of ['scrollTop', 'scrollLeft'] as const) Object.defineProperty(scroller, k, { value: 0, writable: true })
  scroller.scrollTop = 900
  hitTest(page)
  return { scroller, layout }
}

// jsdom has no hit testing at all.
const hitTest = (el: Element) => { document.elementFromPoint = () => el }

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('zoom around the pointer', () => {
  it('keeps the point under the pointer when the page grows', () => {
    const { scroller, layout } = setup()
    // Pointer at (350, 300): page 3 is at top 100 on screen, so this is
    // half-way across it (100 + 250) and 40 % down (100 + 200).
    const a = captureZoomAnchor(350, 300)!
    expect(a.page).toBe(3)
    expect(a.fx).toBeCloseTo(0.5)
    expect(a.fy).toBeCloseTo(0.4)

    layout(1000)                     // zoomed ×2
    restoreZoomAnchor(a)
    const r = scroller.querySelector(`[${PAGE_ATTR}]`)!.getBoundingClientRect()
    expect(r.left + 0.5 * r.width).toBeCloseTo(350)
    expect(r.top + 0.4 * r.height).toBeCloseTo(300)
  })

  it('anchors nothing outside a scrolling view', () => {
    hitTest(document.body)
    expect(captureZoomAnchor(10, 10)).toBeNull()
  })
})
