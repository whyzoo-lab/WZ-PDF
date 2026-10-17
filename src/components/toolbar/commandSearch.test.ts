import { describe, it, expect } from 'vitest'
import { choseong, rank, score } from './commandSearch'

describe('command search', () => {
  it('ranks a match by where it starts', () => {
    expect(score('Print', 'print')).toBe(0)
    expect(score('Save as PDF', 'pdf')).toBe(8)
    expect(score('Print', 'zz')).toBeNull()
  })

  it('falls back to the typed letters in order', () => {
    expect(score('Save as PDF', 'svpdf')).toBe(100)
  })

  it('finds Korean labels by initial consonants', () => {
    expect(choseong('파일 열기')).toBe('ㅍㅇ ㅇㄱ')
    expect(score('파일 열기', 'ㅇㄱ')).not.toBeNull()
    expect(score('인쇄', 'ㅇㅅ')).not.toBeNull()
    expect(score('인쇄', 'ㅂㅅ')).toBeNull()
  })

  it('matches the English label of a Korean command, and the id last', () => {
    const cmds = [
      { id: 'print', label: '인쇄', alt: 'Print' },
      { id: 'save-pdf', label: 'PDF로 저장', alt: 'Save as PDF' },
      { id: 'zoom-in', label: '확대', alt: 'Zoom in' },
    ]
    expect(rank(cmds, 'print').map(c => c.id)).toEqual(['print'])
    expect(rank(cmds, '저장').map(c => c.id)).toEqual(['save-pdf'])
    expect(rank(cmds, 'zoom').map(c => c.id)).toEqual(['zoom-in'])
  })

  it('puts commands that cannot run now last', () => {
    const cmds = [
      { id: 'a', label: '저장 A', disabled: true },
      { id: 'b', label: '저장 B' },
    ]
    expect(rank(cmds, '저장').map(c => c.id)).toEqual(['b', 'a'])
  })

  it('lists everything, in order, for an empty query', () => {
    const cmds = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
    expect(rank(cmds, '').map(c => c.id)).toEqual(['a', 'b'])
  })
})
