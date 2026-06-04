import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const predictMock = vi.fn()
vi.mock('../services/ocrEngine', () => ({ predict: (...a: unknown[]) => predictMock(...a) }))

const getOrRenderPageMock = vi.fn()
vi.mock('./usePdfPage', () => ({ getOrRenderPage: (...a: unknown[]) => getOrRenderPageMock(...a) }))

import { useOcr } from './useOcr'

const fakeDoc = {} as import('pdfjs-dist').PDFDocumentProxy
const fakeCanvas = () => ({ canvas: document.createElement('canvas'), width: 15, height: 15 })

beforeEach(() => {
  predictMock.mockReset()
  getOrRenderPageMock.mockReset()
  getOrRenderPageMock.mockResolvedValue(fakeCanvas())
})

describe('useOcr', () => {
  it('runs a page, stores words in PDF points, and caches (no second predict)', async () => {
    predictMock.mockResolvedValue([{ box: [[0,0],[15,0],[15,15],[0,15]], text: 'hi', score: 0.9 }])
    const { result } = renderHook(() => useOcr(fakeDoc, 3))

    await act(async () => { await result.current.runPage(1) })
    const r = result.current.ocrResults.get(1)
    expect(r?.status).toBe('done')
    expect(r?.words[0]).toMatchObject({ text: 'hi', x: 0, y: 0, width: 10, height: 10 }) // /1.5

    await act(async () => { await result.current.runPage(1) }) // cache hit
    expect(predictMock).toHaveBeenCalledTimes(1)
  })

  it('isolates a per-page failure during whole-doc run', async () => {
    predictMock
      .mockResolvedValueOnce([{ box: [[0,0],[3,0],[3,3],[0,3]], text: 'a', score: 1 }])
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([{ box: [[0,0],[3,0],[3,3],[0,3]], text: 'c', score: 1 }])
    const { result } = renderHook(() => useOcr(fakeDoc, 3))

    await act(async () => { await result.current.runAll() })
    expect(result.current.ocrResults.get(1)?.status).toBe('done')
    expect(result.current.ocrResults.get(2)?.status).toBe('error')
    expect(result.current.ocrResults.get(3)?.status).toBe('done')
  })

  it('sets ocrError when the engine fails to load on the first page', async () => {
    getOrRenderPageMock.mockResolvedValue(fakeCanvas())
    predictMock.mockRejectedValue(new Error('OCR engine failed to load: wasm 404'))
    const { result } = renderHook(() => useOcr(fakeDoc, 1))
    await act(async () => { await result.current.runPage(1) })
    await waitFor(() => expect(result.current.ocrError).toMatch(/failed to load/))
  })
})
