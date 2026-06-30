import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSearch } from './useSearch'

// pdfjs doc whose pages have NO text items (scanned) — forces OCR fallback.
function emptyTextDoc() {
  return {
    getPage: vi.fn(async () => ({ getTextContent: async () => ({ items: [] }) })),
  } as unknown as import('../types/viewerDoc').ViewerDoc
}

describe('useSearch with OCR provider', () => {
  it('searches OCR words when the page has no pdfjs text', async () => {
    const doc = emptyTextDoc()
    const ocrProvider = (page: number) => (page === 1 ? ['hello', 'world'] : undefined)
    const { result } = renderHook(() => useSearch(doc, 1, ocrProvider))

    await act(async () => { await result.current.run('world') })
    expect(result.current.matches).toHaveLength(1)
    expect(result.current.matches[0]).toMatchObject({ page: 1, itemStart: 1, itemEnd: 1 })
  })
})
