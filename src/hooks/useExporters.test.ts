import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ViewerDoc } from '../types/viewerDoc'

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
const exportHwpToPdf = vi.fn(async () => PDF)
vi.mock('../services/pdfExporter', () => ({ exportHwpToPdf, exportPdf: vi.fn() }))

const { useExporters } = await import('./useExporters')

function setup(over: Partial<Parameters<typeof useExporters>[0]> = {}) {
  const onSuccess = vi.fn()
  const onError = vi.fn()
  const { result } = renderHook(() => useExporters({
    file: { name: 'report.hwp' }, fileBytes: new ArrayBuffer(8), bytesUnavailable: null,
    pdfDoc: { numPages: 1 } as unknown as ViewerDoc, numPages: 1, annotations: [],
    kind: 'hwp', documentPassword: null, savePassword: null, onSuccess, onError, ...over,
  }))
  return { result, onSuccess, onError }
}

afterEach(() => { vi.unstubAllGlobals(); exportHwpToPdf.mockClear() })

describe('EXE export', () => {
  it('embeds a PDF when the document is a HWP, not the HWP bytes', async () => {
    const exportExe = vi.fn(async (bytes: ArrayBuffer) => ({ success: bytes.byteLength > 0 }))
    vi.stubGlobal('electronAPI', { exportExe })
    const { result, onSuccess } = setup()
    await act(async () => { await result.current.handleExportExe() })
    expect(exportHwpToPdf).toHaveBeenCalledTimes(1)
    const sent = new Uint8Array(exportExe.mock.calls[0][0])
    expect(Array.from(sent.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46])
    expect(onSuccess).toHaveBeenCalled()
  })

  it('reports a failure through onError, not a blocking alert', async () => {
    vi.stubGlobal('electronAPI', { exportExe: vi.fn(async () => ({ success: false, error: 'disk full' })) })
    const alert = vi.fn(); vi.stubGlobal('alert', alert)
    const { result, onError } = setup()
    await act(async () => { await result.current.handleExportExe() })
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('disk full'))
    expect(alert).not.toHaveBeenCalled()
  })

  it('says why a document too large to hold cannot be exported', async () => {
    const exportExe = vi.fn()
    vi.stubGlobal('electronAPI', { exportExe })
    const { result, onError } = setup({ kind: 'pdf', fileBytes: null, bytesUnavailable: 'too large' })
    await act(async () => { await result.current.handleExportExe() })
    expect(onError).toHaveBeenCalledWith('too large')
    expect(exportExe).not.toHaveBeenCalled()
  })
})
