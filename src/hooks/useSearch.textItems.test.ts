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
