// src/services/pdfExporter.hwp.test.ts
import { describe, it, expect, vi } from 'vitest'

const addPage = vi.fn(() => ({ drawImage: vi.fn() }))
const embedJpg = vi.fn(async () => ({ width: 100, height: 200 }))
vi.mock('@cantoo/pdf-lib', () => ({
  PDFDocument: { create: async () => ({ addPage, embedJpg, save: async () => new Uint8Array([1]) }) },
  StandardFonts: { Helvetica: 'Helvetica' },
  rgb: vi.fn(),
  degrees: vi.fn(),
}))
vi.mock('./pageRender', () => ({
  getOrRenderPage: async () => ({
    canvas: Object.assign(document.createElement('canvas'), {
      width: 100, height: 200,
      toBlob: (done: (b: Blob) => void) => done(new Blob([new Uint8Array([0xff, 0xd8])])),
    }),
    renderScale: 1,
  }),
}))

import { exportHwpToPdf } from './pdfExporter'

describe('exportHwpToPdf', () => {
  it('builds a pdf-lib page per HWP page from rendered canvases', async () => {
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale, scale }) }
    const doc = { numPages: 2, getPage: vi.fn(async () => page), destroy: vi.fn() }
    const bytes = await exportHwpToPdf(doc as never, [])
    expect(addPage).toHaveBeenCalledTimes(2)
    // The page is the page's own size, not the raster's.
    expect(addPage).toHaveBeenCalledWith([100, 200])
    expect(bytes).toBeInstanceOf(Uint8Array)
  })

  it('writes only the pages asked for ("save selection")', async () => {
    addPage.mockClear()
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale, scale }) }
    const doc = { numPages: 5, getPage: vi.fn(async () => page), destroy: vi.fn() }
    await exportHwpToPdf(doc as never, [], undefined, undefined, [2, 4])
    expect(addPage).toHaveBeenCalledTimes(2)
    expect(doc.getPage.mock.calls.map(c => (c as unknown[])[0])).toEqual([2, 4])
  })
})
