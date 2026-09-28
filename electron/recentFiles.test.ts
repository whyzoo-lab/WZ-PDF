import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { RECENT_LIMIT, addRecent, isRecentCandidate, parseRecent, removeRecent } from './recentFiles.ts'

// Absolute paths in this platform's own form: `C:\docs\a.pdf` on Windows,
// `/docs/a.pdf` on the Linux CI runner — a Windows path is not absolute there.
const root = path.parse(process.cwd()).root
const abs = (...parts: string[]) => path.join(root, ...parts)

describe('recent files', () => {
  it('puts the latest first, once', () => {
    let list = addRecent([], abs('docs', 'a.pdf'), 1)
    list = addRecent(list, abs('docs', 'b.hwp'), 2)
    list = addRecent(list, abs('docs', 'a.pdf'), 3)
    expect(list.map(r => r.path)).toEqual([abs('docs', 'a.pdf'), abs('docs', 'b.hwp')])
    expect(list[0].openedAt).toBe(3)
  })

  it(`keeps at most ${RECENT_LIMIT}`, () => {
    let list = addRecent([], abs('d', '0.pdf'))
    for (let i = 1; i < 20; i++) list = addRecent(list, abs('d', `${i}.pdf`))
    expect(list).toHaveLength(RECENT_LIMIT)
    expect(list[0].path).toBe(abs('d', '19.pdf'))
  })

  it('keeps only absolute paths to formats the app opens', () => {
    expect(isRecentCandidate(abs('docs', 'a.pdf'))).toBe(true)
    expect(isRecentCandidate(abs('docs', 'note.md'))).toBe(true)
    expect(isRecentCandidate('a.pdf')).toBe(false)             // relative
    expect(isRecentCandidate(abs('Windows', 'evil.exe'))).toBe(false)
    expect(isRecentCandidate(abs('a\0.pdf'))).toBe(false)
    expect(isRecentCandidate(42)).toBe(false)
    expect(addRecent([], abs('Windows', 'evil.exe'))).toEqual([])
  })

  it('removes an entry', () => {
    const list = addRecent(addRecent([], abs('a.pdf')), abs('b.pdf'))
    expect(removeRecent(list, abs('a.pdf')).map(r => r.path)).toEqual([abs('b.pdf')])
  })

  it('survives a damaged file on disk', () => {
    expect(parseRecent('not json')).toEqual([])
    expect(parseRecent('{"path":"x"}')).toEqual([])
    expect(parseRecent(JSON.stringify([{ path: abs('ok.pdf'), openedAt: 1 }, { path: 'rel.pdf', openedAt: 2 }, 'junk'])))
      .toEqual([{ path: abs('ok.pdf'), openedAt: 1 }])
  })
})
