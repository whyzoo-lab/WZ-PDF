import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../services/printPreview', () => ({
  renderPdfPreview: vi.fn(async () => ['blob:page-1', 'blob:page-2']),
}))

import { usePrint } from './usePrint'

afterEach(() => vi.restoreAllMocks())

describe('previewThenPrint (Office, Markdown, mail)', () => {
  const setup = () => {
    const onError = vi.fn()
    const hook = renderHook(() => usePrint({ pdfDoc: null, numPages: 0, annotations: [], onError }))
    return { hook, onError }
  }

  it('shows the PDF\'s pages, and confirming prints the job — not the pictures', async () => {
    const { hook } = setup()
    const windowPrint = vi.spyOn(window, 'print').mockImplementation(() => {})
    const print = vi.fn(async () => {})
    await act(() => hook.result.current.previewThenPrint(async () => new Uint8Array([1]), print))
    expect(hook.result.current.previewPages).toEqual(['blob:page-1', 'blob:page-2'])

    await act(() => hook.result.current.confirmPrint())
    expect(print).toHaveBeenCalledTimes(1)
    expect(windowPrint).not.toHaveBeenCalled()
    expect(hook.result.current.previewPages).toBeNull()
  })

  it('prints nothing when the preview is cancelled', async () => {
    const { hook } = setup()
    const print = vi.fn(async () => {})
    await act(() => hook.result.current.previewThenPrint(async () => new Uint8Array([1]), print))
    act(() => hook.result.current.cancelPrint())
    expect(hook.result.current.previewPages).toBeNull()
    expect(print).not.toHaveBeenCalled()
  })

  it('reports a PDF that could not be made, and opens no preview', async () => {
    const { hook, onError } = setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(() => hook.result.current.previewThenPrint(async () => { throw new Error('boom') }, vi.fn()))
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('boom'))
    expect(hook.result.current.previewPages).toBeNull()
    expect(hook.result.current.isPrinting).toBe(false)
  })
})
