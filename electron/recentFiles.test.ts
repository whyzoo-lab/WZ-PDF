import { describe, it, expect } from 'vitest'
import { RECENT_LIMIT, addRecent, isRecentCandidate, parseRecent, removeRecent } from './recentFiles.ts'

describe('recent files', () => {
  it('puts the latest first, once', () => {
    let list = addRecent([], 'C:\\docs\\a.pdf', 1)
    list = addRecent(list, 'C:\\docs\\b.hwp', 2)
    list = addRecent(list, 'C:\\docs\\a.pdf', 3)
    expect(list.map(r => r.path)).toEqual(['C:\\docs\\a.pdf', 'C:\\docs\\b.hwp'])
    expect(list[0].openedAt).toBe(3)
  })

  it(`keeps at most ${RECENT_LIMIT}`, () => {
    let list = addRecent([], 'C:\\d\\0.pdf')
    for (let i = 1; i < 20; i++) list = addRecent(list, `C:\\d\\${i}.pdf`)
    expect(list).toHaveLength(RECENT_LIMIT)
    expect(list[0].path).toBe('C:\\d\\19.pdf')
  })

  it('keeps only absolute paths to formats the app opens', () => {
    expect(isRecentCandidate('C:\\docs\\a.pdf')).toBe(true)
    expect(isRecentCandidate('C:\\docs\\note.md')).toBe(true)
    expect(isRecentCandidate('a.pdf')).toBe(false)             // relative
    expect(isRecentCandidate('C:\\Windows\\evil.exe')).toBe(false)
    expect(isRecentCandidate('C:\\a\0.pdf')).toBe(false)
    expect(isRecentCandidate(42)).toBe(false)
    expect(addRecent([], 'C:\\Windows\\evil.exe')).toEqual([])
  })

  it('removes an entry', () => {
    const list = addRecent(addRecent([], 'C:\\a.pdf'), 'C:\\b.pdf')
    expect(removeRecent(list, 'C:\\a.pdf').map(r => r.path)).toEqual(['C:\\b.pdf'])
  })

  it('survives a damaged file on disk', () => {
    expect(parseRecent('not json')).toEqual([])
    expect(parseRecent('{"path":"x"}')).toEqual([])
    expect(parseRecent(JSON.stringify([{ path: 'C:\\ok.pdf', openedAt: 1 }, { path: 'rel.pdf', openedAt: 2 }, 'junk'])))
      .toEqual([{ path: 'C:\\ok.pdf', openedAt: 1 }])
  })
})
