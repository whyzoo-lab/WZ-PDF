import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { EAGER_DOCUMENT_MAX_BYTES, RANGE_INITIAL_BYTES, type RangedFile } from '../services/documentSource'

vi.mock('pdfjs-dist', () => ({
  // The hook sets the worker src on first load, so the mock needs this too.
  GlobalWorkerOptions: {} as { workerSrc?: string },
  // Shape only: the hook constructs it and assigns requestDataRange.
  PDFDataRangeTransport: class {
    length: number
    initialData: Uint8Array | null
    constructor(length: number, initialData: Uint8Array | null) {
      this.length = length
      this.initialData = initialData
    }
    onDataRange() {}
    requestDataRange() {}
  },
  // pdfjs 6 shape: the loading task owns destroy(); the document proxy has none.
  getDocument: (params: Record<string, unknown>) => {
    lastParams = params
    const task = { promise: Promise.resolve({ numPages: 5, getPage: vi.fn() }), destroy: vi.fn().mockResolvedValue(undefined) }
    lastTask = task
    return task
  },
}))
// Stub the worker bootstrap: it builds a Blob URL, which jsdom need not support.
vi.mock('../services/pdfjsWorker', () => ({ getPdfWorkerUrl: () => 'blob:mock-pdf-worker' }))
const loadHwp = vi.fn().mockResolvedValue({ pageCount: () => 7, free: vi.fn(), renderPageToCanvas: vi.fn() })
vi.mock('../services/hwpEngine', () => ({ loadHwp: (...a: unknown[]) => loadHwp(...a) }))

let lastTask: { destroy: ReturnType<typeof vi.fn> } | null = null
let lastParams: Record<string, unknown> | null = null

import { usePdfDocument } from './usePdfDocument'

function file(name: string, bytes: number[]) {
  const f = new File([new Uint8Array(bytes)], name)
  // jsdom File.arrayBuffer is present; ensure it resolves our bytes
  return f
}

/** A document too large to hold, whose first bytes are `head`. No buffer of its size is ever made. */
function largeFile(name: string, head: number[]): RangedFile {
  return {
    name,
    size: EAGER_DOCUMENT_MAX_BYTES * 3,
    type: '',
    readRange: vi.fn(async (begin: number, end: number) => {
      const out = new Uint8Array(end - begin)
      out.set(head.slice(begin, end))
      return out
    }),
  }
}

beforeEach(() => { loadHwp.mockClear(); lastParams = null })

describe('usePdfDocument', () => {
  it('loads a PDF via pdfjs and reports kind=pdf', async () => {
    const input = file('a.pdf', [0x25,0x50,0x44,0x46])
    const { result } = renderHook(() => usePdfDocument(input))
    await waitFor(() => expect(result.current.numPages).toBe(5))
    expect(result.current.kind).toBe('pdf')
    expect(lastParams?.data).toBeInstanceOf(ArrayBuffer)
    expect(lastParams?.range).toBeUndefined()
  })
  it('tears the worker down through the loading task when the document goes away', async () => {
    // pdfjs 6 removed PDFDocumentProxy.destroy(); calling it threw at unmount
    // while tsc stayed green, because the proxy is cast to ViewerDoc.
    const input = file('a.pdf', [0x25,0x50,0x44,0x46])
    const { result, unmount } = renderHook(() => usePdfDocument(input))
    await waitFor(() => expect(result.current.numPages).toBe(5))
    unmount()
    expect(lastTask?.destroy).toHaveBeenCalledTimes(1)
  })
  it('loads an HWP via the adapter and reports kind=hwp', async () => {
    const input = file('a.hwp', [0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1])
    const { result } = renderHook(() => usePdfDocument(input))
    await waitFor(() => expect(result.current.numPages).toBe(7))
    expect(result.current.kind).toBe('hwp')
    expect(loadHwp).toHaveBeenCalled()
  })
})

describe('a document too large to hold', () => {
  it('pages a PDF in by range instead of reading it whole', async () => {
    const input = largeFile('big.pdf', [0x25, 0x50, 0x44, 0x46])
    const { result } = renderHook(() => usePdfDocument(input))
    await waitFor(() => expect(result.current.numPages).toBe(5))
    expect(result.current.kind).toBe('pdf')
    expect(lastParams?.range).toBeDefined()
    expect(lastParams?.data).toBeUndefined()
    // Otherwise pdfjs would go on to fetch the rest of the file in the background.
    expect(lastParams?.disableAutoFetch).toBe(true)
    // What was read: the first megabyte, to identify it. Never the whole file.
    expect(input.readRange).toHaveBeenCalledWith(0, RANGE_INITIAL_BYTES)
    expect(input.readRange).not.toHaveBeenCalledWith(0, input.size)
  })

  it('refuses a large file that is not a PDF, and says why', async () => {
    // rhwp, the image decoder and the mail/Markdown parsers all need the whole input.
    const input = largeFile('big.hwp', [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
    const { result } = renderHook(() => usePdfDocument(input))
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toMatch(/PDF/)
    expect(loadHwp).not.toHaveBeenCalled()
  })
})
