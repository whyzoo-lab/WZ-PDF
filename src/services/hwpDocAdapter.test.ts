// src/services/hwpDocAdapter.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createHwpViewerDoc } from './hwpDocAdapter'

function fakeDoc() {
  return {
    pageCount: () => 2,
    free: vi.fn(),
    // sizes the canvas to 60x80 at scale 1 (so natural = 60x80)
    renderPageToCanvas: vi.fn((_n: number, canvas: HTMLCanvasElement, scale: number) => {
      canvas.width = 60 * scale; canvas.height = 80 * scale
    }),
  }
}

describe('hwpDocAdapter', () => {
  it('reports page count and frees the document', () => {
    const d = fakeDoc(); const v = createHwpViewerDoc(d as never)
    expect(v.numPages).toBe(2)
    v.destroy(); expect(d.free).toHaveBeenCalled()
  })

  it('getViewport returns natural size × scale', async () => {
    const d = fakeDoc(); const page = await createHwpViewerDoc(d as never).getPage(1)
    expect(page.getViewport({ scale: 1 })).toEqual({ width: 60, height: 80, scale: 1 })
    expect(page.getViewport({ scale: 2 })).toEqual({ width: 120, height: 160, scale: 2 })
  })

  it('render paints onto the given canvas at the viewport scale and resolves', async () => {
    const d = fakeDoc(); const page = await createHwpViewerDoc(d as never).getPage(1)
    const canvas = document.createElement('canvas')
    await page.render({ canvas, viewport: { width: 120, height: 160, scale: 2 } }).promise
    expect(canvas.width).toBe(120)   // 60 * 2
    // renderPageToCanvas called with page index 0 (0-based) at scale 2 for the real render
    expect(d.renderPageToCanvas).toHaveBeenLastCalledWith(0, canvas, 2)
  })

  it('getTextContent is empty (OCR provides text for HWP)', async () => {
    const page = await createHwpViewerDoc(fakeDoc() as never).getPage(1)
    expect(await page.getTextContent()).toEqual({ items: [] })
  })
})
