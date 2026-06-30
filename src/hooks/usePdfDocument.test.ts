import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('pdfjs-dist', () => ({
  getDocument: () => ({ promise: Promise.resolve({ numPages: 5, getPage: vi.fn(), destroy: vi.fn() }) }),
}))
const loadHwp = vi.fn().mockResolvedValue({ pageCount: () => 7, free: vi.fn(), renderPageToCanvas: vi.fn() })
vi.mock('../services/hwpEngine', () => ({ loadHwp: (...a: unknown[]) => loadHwp(...a) }))

import { usePdfDocument } from './usePdfDocument'

function file(name: string, bytes: number[]) {
  const f = new File([new Uint8Array(bytes)], name)
  // jsdom File.arrayBuffer is present; ensure it resolves our bytes
  return f
}

beforeEach(() => loadHwp.mockClear())

describe('usePdfDocument', () => {
  it('loads a PDF via pdfjs and reports kind=pdf', async () => {
    const { result } = renderHook(() => usePdfDocument(file('a.pdf', [0x25,0x50,0x44,0x46])))
    await waitFor(() => expect(result.current.numPages).toBe(5))
    expect(result.current.kind).toBe('pdf')
  })
  it('loads an HWP via the adapter and reports kind=hwp', async () => {
    const { result } = renderHook(() => usePdfDocument(file('a.hwp', [0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1])))
    await waitFor(() => expect(result.current.numPages).toBe(7))
    expect(result.current.kind).toBe('hwp')
    expect(loadHwp).toHaveBeenCalled()
  })
})
