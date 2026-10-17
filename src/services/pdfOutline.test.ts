import { describe, it, expect } from 'vitest'
import { currentOutlineId, flattenOutline, loadOutline } from './pdfOutline'

const ref = (num: number) => ({ num, gen: 0 })
// A pdfjs-shaped document: page refs 10, 11, 12 are pages 1–3; "intro" is a named destination.
const fakeDoc = (items: unknown[]) => ({
  getOutline: async () => items,
  getDestination: async (id: string) => (id === 'intro' ? [ref(11), { name: 'XYZ' }] : null),
  getPageIndex: async (r: { num: number }) => r.num - 10,
})

describe('loadOutline', () => {
  it('resolves explicit, named and index destinations to pages', async () => {
    const nodes = await loadOutline(fakeDoc([
      { title: 'Cover', dest: [ref(10)], url: null, items: [] },
      { title: 'Intro', dest: 'intro', url: null, items: [
        { title: '  Scope\n of work ', dest: [2, { name: 'Fit' }], url: null, items: [] },
      ] },
      { title: 'Site', dest: null, url: 'https://example.com', items: [] },
      { title: 'Broken', dest: 'nowhere', url: null, items: [] },
    ]))
    expect(nodes.map(n => [n.title, n.page])).toEqual([['Cover', 1], ['Intro', 2], ['Site', null], ['Broken', null]])
    expect(nodes[1].children[0]).toMatchObject({ title: 'Scope of work', page: 3 })
    expect(nodes[2].url).toBe('https://example.com')
  })

  it('is empty for a document without one, and for a non-PDF', async () => {
    expect(await loadOutline(fakeDoc([]))).toEqual([])
    expect(await loadOutline({ numPages: 3 })).toEqual([])
  })
})

describe('outline position', () => {
  const nodes = [
    { title: 'A', page: 1, children: [{ title: 'A.1', page: 2, children: [] }] },
    { title: 'B', page: 5, children: [] },
  ]
  it('flattens in reading order with path ids', () => {
    expect(flattenOutline(nodes).map(f => [f.id, f.node.title, f.depth])).toEqual([['0', 'A', 0], ['0.0', 'A.1', 1], ['1', 'B', 0]])
  })
  it('marks the last entry starting at or before the page', () => {
    expect(currentOutlineId(nodes, 1)).toBe('0')
    expect(currentOutlineId(nodes, 4)).toBe('0.0')
    expect(currentOutlineId(nodes, 9)).toBe('1')
  })
})
