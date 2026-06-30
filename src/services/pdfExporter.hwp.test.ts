// src/services/pdfExporter.hwp.test.ts
import { describe, it, expect, vi } from 'vitest'

const addPage = vi.fn(() => ({ drawImage: vi.fn() }))
const embedJpg = vi.fn(async () => ({ width: 100, height: 200 }))
vi.mock('pdf-lib', () => ({
  PDFDocument: { create: async () => ({ addPage, embedJpg, save: async () => new Uint8Array([1]) }) },
  StandardFonts: { Helvetica: 'Helvetica' },
  rgb: vi.fn(),
  degrees: vi.fn(),
}))
vi.mock('../hooks/usePdfPage', () => ({
  getOrRenderPage: async () => ({
    canvas: Object.assign(document.createElement('canvas'), { width: 100, height: 200, toDataURL: () => 'data:image/jpeg;base64,AA' }),
    renderScale: 1,
  }),
}))

import { exportHwpToPdf } from './pdfExporter'

describe('exportHwpToPdf', () => {
  it('builds a pdf-lib page per HWP page from rendered canvases', async () => {
    const doc = { numPages: 2, getPage: vi.fn(), destroy: vi.fn() }
    const bytes = await exportHwpToPdf(doc as never, [])
    expect(addPage).toHaveBeenCalledTimes(2)
    expect(bytes).toBeInstanceOf(Uint8Array)
  })
})
