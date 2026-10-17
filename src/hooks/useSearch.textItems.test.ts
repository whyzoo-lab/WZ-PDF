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
    expect(result.current.matches.map(({ page, itemStart, itemEnd }) => ({ page, itemStart, itemEnd }))).toEqual([{ page: 1, itemStart: 2, itemEnd: 2 }])
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
    expect(result.current.matches.map(({ page, itemStart, itemEnd }) => ({ page, itemStart, itemEnd }))).toEqual([{ page: 1, itemStart: 0, itemEnd: 1 }])
  })
})

describe('useSearch item mapping', () => {
  // The one-pass cursor mapping must agree with the obvious scan it replaced
  // (for every match: the last item starting at or before it, and the last
  // item starting before its end) — including empty items and matches that
  // span several items.
  function bruteForce(items: string[], needle: string) {
    const offsets: number[] = []
    let concat = ''
    for (const s of items) { offsets.push(concat.length); concat += s }
    const out: { itemStart: number; itemEnd: number }[] = []
    for (let from = 0, idx; (idx = concat.toLowerCase().indexOf(needle, from)) >= 0; from = idx + needle.length) {
      let itemStart = 0, itemEnd = 0
      offsets.forEach((o, i) => { if (o <= idx) itemStart = i; if (o < idx + needle.length) itemEnd = i })
      out.push({ itemStart, itemEnd })
    }
    return out
  }

  it('agrees with a full scan on random pages', async () => {
    let seed = 7
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
    for (let round = 0; round < 40; round++) {
      const items = Array.from({ length: 1 + rand(30) }, () => 'abab '.slice(0, rand(6)))
      const needle = ['a', 'ab', 'b a', 'ba', 'abab'][rand(5)]
      const doc = docWithItems(items.map(str => ({ str, hasEOL: false })))
      const { result } = renderHook(() => useSearch(doc, 1))
      await act(async () => { await result.current.run(needle) })
      expect(result.current.matches.map(({ itemStart, itemEnd }) => ({ itemStart, itemEnd }))).toEqual(bruteForce(items, needle))
    }
  })
})

describe('useSearch behaviour', () => {
  function docWithPages(pages: { str: string; hasEOL?: boolean }[][]): ViewerDoc {
    return {
      getPage: vi.fn(async (n: number) => ({ getTextContent: async () => ({ items: pages[n - 1] }) })),
    } as unknown as ViewerDoc
  }

  it('finds a phrase across a line end, with its context', async () => {
    const doc = docWithPages([[{ str: 'the quick', hasEOL: true }, { str: 'brown fox' }]])
    const { result } = renderHook(() => useSearch(doc, 1))
    await act(async () => { await result.current.run('quick brown') })
    expect(result.current.matches).toHaveLength(1)
    expect(result.current.matches[0]).toMatchObject({ itemStart: 0, itemEnd: 1, snippet: { hit: 'quick brown' } })
  })

  it('makes the first match at or after the page in view the current one', async () => {
    const doc = docWithPages([[{ str: 'apple' }], [{ str: 'pear' }], [{ str: 'apple' }], [{ str: 'apple' }]])
    const { result } = renderHook(() => useSearch(doc, 4, undefined, 3))
    await act(async () => { await result.current.run('apple') })
    expect(result.current.matches.map(m => m.page)).toEqual([1, 3, 4])
    expect(result.current.active?.page).toBe(3)
  })

  it('searches again when case sensitivity is switched on', async () => {
    const doc = docWithPages([[{ str: 'Seoul seoul SEOUL' }]])
    const { result } = renderHook(() => useSearch(doc, 1))
    await act(async () => { await result.current.run('seoul') })
    expect(result.current.matches.map(m => m.snippet?.hit)).toEqual(['Seoul', 'seoul', 'SEOUL'])
    await act(async () => { result.current.setOptions({ caseSensitive: true, wholeWord: false }) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(result.current.matches.map(m => m.snippet?.hit)).toEqual(['seoul'])
  })
})
