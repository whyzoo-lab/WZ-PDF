import { describe, expect, it } from 'vitest'
import { pageSuffix } from './pageSuffix'

describe('naming a saved page selection', () => {
  it('names a single page by its number', () => {
    expect(pageSuffix([3])).toBe('_p3')
  })

  it('names consecutive pages as a range', () => {
    expect(pageSuffix([3, 4, 5])).toBe('_p3-5')
  })

  it('counts a scattered selection instead of inventing a range', () => {
    // `_p3-9` would name a file of seven pages when four were saved.
    expect(pageSuffix([3, 5, 7, 9])).toBe('_4p')
  })

  it('does not care what order the pages were clicked in', () => {
    expect(pageSuffix([5, 3, 4])).toBe('_p3-5')
  })

  it('ignores a page selected twice', () => {
    expect(pageSuffix([2, 2])).toBe('_p2')
    expect(pageSuffix([2, 3, 3, 4])).toBe('_p2-4')
  })

  it('has nothing to add when nothing is selected', () => {
    expect(pageSuffix([])).toBe('')
  })
})
