import { describe, it, expect } from 'vitest'
import { deleteEntries, insertEntries, reorderEntries } from './imageSetOps'

const E = (...ids: string[]) => ids.map(src => ({ src }))
const ids = (r: { entries: { src: string }[] }) => r.entries.map(e => e.src)

describe('image collection page operations', () => {
  it('deletes pages and maps the survivors', () => {
    const r = deleteEntries(E('a', 'b', 'c', 'd'), [2, 4])
    expect(ids(r)).toEqual(['a', 'c'])
    expect([...r.pageMapping]).toEqual([[1, 1], [3, 2]])
  })

  it('refuses to delete every page', () => {
    expect(() => deleteEntries(E('a', 'b'), [1, 2])).toThrow()
  })

  it('reorders by old page numbers', () => {
    const r = reorderEntries(E('a', 'b', 'c'), [3, 1, 2])
    expect(ids(r)).toEqual(['c', 'a', 'b'])
    expect(r.pageMapping.get(3)).toBe(1)
    expect(r.pageMapping.get(1)).toBe(2)
  })

  it('refuses an order that drops or repeats a page', () => {
    expect(() => reorderEntries(E('a', 'b', 'c'), [1, 1, 2])).toThrow()
    expect(() => reorderEntries(E('a', 'b', 'c'), [1, 2])).toThrow()
  })

  it('inserts after a page and shifts the rest', () => {
    const r = insertEntries(E('a', 'b', 'c'), 1, E('x', 'y'))
    expect(ids(r)).toEqual(['a', 'x', 'y', 'b', 'c'])
    expect([...r.pageMapping]).toEqual([[1, 1], [2, 4], [3, 5]])
    expect(ids(insertEntries(E('a'), 0, E('x')))).toEqual(['x', 'a'])
  })
})
