import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ViewerDoc } from '../types/viewerDoc'

vi.mock('../services/pdfCommentImport', () => ({ commentRenderParams: async () => ({}) }))
vi.mock('../services/pdfForms', () => ({ applyFormStorage: async () => {} }))
vi.mock('../services/annotationCanvas', () => ({ drawAnnotations: async () => {}, loadImage: async () => null }))

import { usePrint } from './usePrint'

afterEach(() => vi.restoreAllMocks())

/** A document whose pages render, except `failAt`, which cannot be read. */
function docFailingAt(failAt: number): ViewerDoc {
  return {
    getPage: async (n: number) => {
      if (n === failAt) throw new Error('page unreadable')
      return {
        getViewport: () => ({ width: 10, height: 10 }),
        render: () => ({ promise: Promise.resolve() }),
      }
    },
  } as unknown as ViewerDoc
}

describe('handlePrint when a page fails part-way', () => {
  it('revokes the page images already made', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: () => {} } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob(['x'])))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let made = 0
    const create = vi.fn(() => `blob:page-${++made}`)
    const revoke = vi.fn()
    URL.createObjectURL = create
    URL.revokeObjectURL = revoke

    const onError = vi.fn()
    const hook = renderHook(() => usePrint({ pdfDoc: docFailingAt(3), numPages: 4, annotations: [], onError }))
    await act(() => hook.result.current.handlePrint())

    expect(create).toHaveBeenCalledTimes(2)
    expect(revoke.mock.calls.map(c => c[0])).toEqual(['blob:page-1', 'blob:page-2'])
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('page unreadable'))
    expect(hook.result.current.previewPages).toBeNull()
    expect(hook.result.current.isPrinting).toBe(false)
  })
})
