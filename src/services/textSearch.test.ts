import { describe, it, expect } from 'vitest'
import { findAll, snippetAt } from './textSearch'

describe('findAll', () => {
  it('ignores case unless asked not to', () => {
    expect(findAll('Report report REPORT', 'report')).toHaveLength(3)
    expect(findAll('Report report REPORT', 'report', { caseSensitive: true, wholeWord: false })).toEqual([[7, 13]])
  })

  it('finds a phrase across a line break and extra spaces', () => {
    expect(findAll('the quick\nbrown fox', 'quick brown')).toEqual([[4, 15]])
    expect(findAll('the quick    brown fox', 'quick brown')).toEqual([[4, 18]])
  })

  it('does not cross a block boundary', () => {
    // \u001f marks a paragraph boundary in the DOM text index (services/domText).
    expect(findAll('quick\u001fbrown', 'quick brown')).toEqual([])
  })

  it('finds whole words only when asked', () => {
    expect(findAll('cat concat cats', 'cat')).toHaveLength(3)
    expect(findAll('cat concat cats', 'cat', { caseSensitive: false, wholeWord: true })).toEqual([[0, 3]])
    expect(findAll('계약서 계약 계약금', '계약', { caseSensitive: false, wholeWord: true })).toEqual([[4, 6]])
  })

  it('treats regular-expression characters as text', () => {
    expect(findAll('price (net) 3.5', '(net)')).toEqual([[6, 11]])
    expect(findAll('a.b axb', 'a.b')).toEqual([[0, 3]])
  })

  it('finds nothing for an empty query', () => {
    expect(findAll('abc', '   ')).toEqual([])
  })
})

describe('snippetAt', () => {
  it('cuts a line of context around the match', () => {
    const text = 'x'.repeat(50) + ' the target word ' + 'y'.repeat(50)
    const [[s, e]] = findAll(text, 'target')
    const sn = snippetAt(text, s, e, 8)
    expect(sn.hit).toBe('target')
    expect(sn.before.startsWith('…')).toBe(true)
    expect(sn.after.endsWith('…')).toBe(true)
  })
})
