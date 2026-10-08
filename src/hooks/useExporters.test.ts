import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ViewerDoc } from '../types/viewerDoc'
import type { Annotation } from '../types/annotation'

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
const exportHwpToPdf = vi.fn(async () => PDF)
const exportPdf = vi.fn(async () => new Blob([PDF]))
vi.mock('../services/pdfExporter', () => ({ exportHwpToPdf, exportPdf }))

const STAMP = { id: 's1', type: 'stamp', page: 1, x: 10, y: 10, width: 72, height: 72, src: 'data:' } as unknown as Annotation

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

afterEach(() => { vi.unstubAllGlobals(); exportHwpToPdf.mockClear(); exportPdf.mockClear() })

/** What the exe was given: its bytes and the name it carries them under. */
function sent(exportExe: ReturnType<typeof vi.fn>) {
  const [bytes, name] = exportExe.mock.calls[0] as [ArrayBuffer, string]
  return { bytes: new Uint8Array(bytes), name }
}

describe('EXE export', () => {
  it('carries a HWP as itself, under its own name', async () => {
    const exportExe = vi.fn(async () => ({ success: true }))
    vi.stubGlobal('electronAPI', { exportExe })
    const hwp = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4])
    const { result, onSuccess } = setup({ fileBytes: hwp.buffer })
    await act(async () => { await result.current.handleExportExe() })
    expect(exportHwpToPdf).not.toHaveBeenCalled()
    expect(sent(exportExe).name).toBe('report.hwp')
    expect(Array.from(sent(exportExe).bytes)).toEqual(Array.from(hwp))
    expect(onSuccess).toHaveBeenCalled()
  })

  it('carries the PDF with the stamps when there are any, so they are not lost', async () => {
    const exportExe = vi.fn(async () => ({ success: true }))
    vi.stubGlobal('electronAPI', { exportExe })
    const { result } = setup({ annotations: [STAMP] })
    await act(async () => { await result.current.handleExportExe() })
    expect(exportHwpToPdf).toHaveBeenCalledTimes(1)
    expect(sent(exportExe).name).toBe('report.pdf')
    expect(Array.from(sent(exportExe).bytes.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46])
  })

  it('carries a locked PDF as it is, so the exe asks for the same password', async () => {
    const exportExe = vi.fn(async () => ({ success: true }))
    vi.stubGlobal('electronAPI', { exportExe })
    const locked = new Uint8Array([0x25, 0x50, 0x44, 0x46, 9, 9])
    const { result } = setup({
      kind: 'pdf', file: { name: 'secret.pdf' }, fileBytes: locked.buffer,
      documentPassword: 'pw', savePassword: 'pw',
    })
    await act(async () => { await result.current.handleExportExe() })
    expect(exportPdf).not.toHaveBeenCalled()
    expect(Array.from(sent(exportExe).bytes)).toEqual(Array.from(locked))
  })

  it('carries out a password taken off with the padlock', async () => {
    const exportExe = vi.fn(async () => ({ success: true }))
    vi.stubGlobal('electronAPI', { exportExe })
    const { result } = setup({
      kind: 'pdf', file: { name: 'secret.pdf' }, fileBytes: PDF.slice().buffer,
      documentPassword: 'pw', savePassword: null,
    })
    await act(async () => { await result.current.handleExportExe() })
    expect(exportPdf).toHaveBeenCalledWith(expect.anything(), [], { sourcePassword: 'pw', password: undefined }, undefined)
    expect(sent(exportExe).name).toBe('secret.pdf')
  })

  it('carries a deck, a sheet or mail as the file itself', async () => {
    const exportExe = vi.fn(async () => ({ success: true }))
    vi.stubGlobal('electronAPI', { exportExe })
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 7])
    const { result } = setup({ kind: 'pptx', file: { name: '발표.pptx' }, fileBytes: zip.buffer, pdfDoc: null })
    await act(async () => { await result.current.handleExportExe() })
    expect(sent(exportExe).name).toBe('발표.pptx')
    expect(Array.from(sent(exportExe).bytes)).toEqual(Array.from(zip))
  })

  it('carries Markdown as the editor has it, unsaved edits included', async () => {
    const exportExe = vi.fn(async () => ({ success: true }))
    vi.stubGlobal('electronAPI', { exportExe })
    const { result } = setup({
      kind: 'md', file: { name: 'notes.md' }, fileBytes: new TextEncoder().encode('# old').buffer, pdfDoc: null,
      getMarkdownText: () => '# 새 제목',
    })
    await act(async () => { await result.current.handleExportExe() })
    expect(sent(exportExe).name).toBe('notes.md')
    expect(new TextDecoder().decode(sent(exportExe).bytes)).toBe('# 새 제목')
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
