import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSearch } from './useSearch'
import type { ViewerDoc } from '../types/viewerDoc'

// Real getTextContent output interleaves marked-content markers (no `str`) with
// text items, and has empty-string items that only carry a line end. The text
// layer creates an element for every item with a `str` and none for markers, so
// match indices must count string items only.
function docWithItems(items: unknown[]): ViewerDoc {
  return {
    getPage: vi.fn(async () => ({ getTextContent: async () => ({ items }) })),
  } as unknown as ViewerDoc
}

describe('useSearch item indices', () => {
  it('counts only string items, skipping marked-content markers', async () => {
    const doc = docWithItems([
      { type: 'beginMarkedContent', tag: 'P' },
      { str: 'Hello', hasEOL: false },
      { str: '', hasEOL: true },
      { type: 'endMarkedContent' },
      { type: 'beginMarkedContentProps', tag: 'Span', id: 'mc1' },
      { str: 'world', hasEOL: false },
      { type: 'endMarkedContent' },
    ])
    const { result } = renderHook(() => useSearch(doc, 1))

    await act(async () => { await result.current.run('world') })
    expect(result.current.matches).toEqual([{ page: 1, itemStart: 2, itemEnd: 2 }])
  })

  it('maps a match that spans two items to both of their string indices', async () => {
    const doc = docWithItems([
      { type: 'beginMarkedContent' },
      { str: 'foo', hasEOL: false },
      { type: 'endMarkedContent' },
      { str: 'bar', hasEOL: false },
    ])
    const { result } = renderHook(() => useSearch(doc, 1))

    await act(async () => { await result.current.run('oob') })
    expect(result.current.matches).toEqual([{ page: 1, itemStart: 0, itemEnd: 1 }])
  })
})
