import { describe, it, expect } from 'vitest'
import { compareWords, compareReport, type Word } from './textCompare'

const words = (s: string, page = 1): Word[] => s.split(/\s+/).filter(Boolean).map((text, i) => ({ text, page, rect: { x: i * 30, y: 10, width: 25, height: 10 } }))

describe('compareWords', () => {
  it('finds nothing in the same text', () => {
    expect(compareWords(words('a b c'), words('a b c')).changes).toEqual([])
  })

  it('tells replaced, inserted and deleted apart', () => {
    const c = compareWords(words('계약 기간은 1년 이며 갱신 가능'), words('계약 기간은 2년 이며 자동 갱신 가능'))
    expect(c.changes.map(ch => [ch.kind, ch.old.text, ch.new.text])).toEqual([
      ['replaced', '1년', '2년'],
      ['inserted', '', '자동'],
    ])
    expect(compareWords(words('a b c'), words('a c')).changes.map(ch => [ch.kind, ch.old.text])).toEqual([['deleted', 'b']])
  })

  it('marks lines and, for a one-sided change, where it would be', () => {
    const c = compareWords(words('a b c d'), words('a x y d'))
    expect(c.changes[0].new.rects).toEqual([{ x: 30, y: 10, width: 55, height: 10 }]) // x and y on one line
    const ins = compareWords(words('a d'), words('a b d')).changes[0]
    expect(ins.old.near).toEqual({ x: 30, y: 10, width: 25, height: 10 }) // by "d" in the old text
  })

  it('handles long documents by anchoring on unique words', () => {
    const base = Array.from({ length: 6000 }, (_, i) => `w${i}`)
    const edited = [...base]
    edited[1000] = 'CHANGED'
    edited.splice(4000, 1)
    const c = compareWords(base.map(t => ({ text: t, page: 1 })), edited.map(t => ({ text: t, page: 1 })))
    expect(c.changes.map(ch => [ch.kind, ch.old.text, ch.new.text])).toEqual([
      ['replaced', 'w1000', 'CHANGED'],
      ['deleted', 'w4000', ''],
    ])
  })

  it('compares Unicode as written, in one normal form', () => {
    expect(compareWords([{ text: '한', page: 1 }], [{ text: '한'.normalize('NFD'), page: 1 }]).changes).toEqual([])
  })
})

describe('compareReport', () => {
  it('lists each change with its pages', () => {
    const c = compareWords(words('a b'), words('a c', 2))
    const text = compareReport(c, 'old.pdf', 'new.pdf', {
      title: 'Report', old: 'Old', new: 'New', summary: '1 change', identical: 'Same',
      kind: { inserted: 'Inserted', deleted: 'Deleted', replaced: 'Replaced' },
      page: (o, n) => `old p${o}, new p${n}`,
    })
    expect(text).toContain('1. Replaced (old p1, new p2)')
    expect(text).toContain('   Old: b')
    expect(text).toContain('   New: c')
  })
})
