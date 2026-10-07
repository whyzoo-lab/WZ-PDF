import { describe, expect, it } from 'vitest'
import { PendingVideoSaves, cleanSuggestedName, validateMp4 } from './videoSave'

describe('cleanSuggestedName', () => {
  it('keeps a suggested name a file name ending in .mp4', () => {
    expect(cleanSuggestedName('발표자료.mp4')).toBe('발표자료.mp4')
    expect(cleanSuggestedName('발표자료')).toBe('발표자료.mp4')
    expect(cleanSuggestedName('..\\..\\Windows\\evil.mp4')).toBe('evil.mp4')
    expect(cleanSuggestedName('a<b>:c?.mp4')).toBe('abc.mp4')
    expect(cleanSuggestedName('a\u0007b\u001f.mp4')).toBe('ab.mp4')
    expect(cleanSuggestedName(42)).toBe('presentation.mp4')
  })
})

describe('PendingVideoSaves', () => {
  it('hands back a chosen path once, and nothing for a token it never gave', () => {
    const saves = new PendingVideoSaves()
    const token = saves.add('D:/x.mp4')
    expect(saves.take('not-a-token')).toBeUndefined()
    expect(saves.take(token)).toBe('D:/x.mp4')
    expect(saves.take(token)).toBeUndefined()
  })

  it('forgets a choice that has waited too long', () => {
    let now = 0
    const saves = new PendingVideoSaves(1000, () => now)
    const token = saves.add('D:/x.mp4')
    now = 2000
    expect(saves.take(token)).toBeUndefined()
  })
})

describe('validateMp4', () => {
  it('accepts an MP4 and refuses anything else', () => {
    const mp4 = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0])
    expect(validateMp4(mp4)).toBe(mp4)
    expect(() => validateMp4(new Uint8Array(20))).toThrow()
    expect(() => validateMp4('mp4')).toThrow()
  })
})
