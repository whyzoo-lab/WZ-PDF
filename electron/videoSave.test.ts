import { describe, expect, it } from 'vitest'
import path from 'path'
import { PendingVideoSaves, cleanSuffix, cleanSuggestedName, validateVideoFiles, videoSetPaths } from './videoSave'

describe('videoSetPaths', () => {
  it('puts the whole set beside the .mp4 the reader named', () => {
    const p = videoSetPaths(path.join('D:', 'talks', '발표.mp4'), '자막 포함')
    expect(p).toEqual({
      plain: path.join('D:', 'talks', '발표.mp4'),
      captioned: path.join('D:', 'talks', '발표 (자막 포함).mp4'),
      srt: path.join('D:', 'talks', '발표.srt'),
      vtt: path.join('D:', 'talks', '발표.vtt'),
    })
  })
})

describe('names from the renderer', () => {
  it('keeps a suggested name a file name ending in .mp4', () => {
    expect(cleanSuggestedName('발표자료.mp4')).toBe('발표자료.mp4')
    expect(cleanSuggestedName('발표자료')).toBe('발표자료.mp4')
    expect(cleanSuggestedName('..\\..\\Windows\\evil.mp4')).toBe('evil.mp4')
    expect(cleanSuggestedName('a<b>:c?.mp4')).toBe('abc.mp4')
    expect(cleanSuggestedName('a\u0007b\u001f.mp4')).toBe('ab.mp4')
    expect(cleanSuggestedName(42)).toBe('presentation.mp4')
  })

  it('keeps a suffix free of anything that would make it a path', () => {
    expect(cleanSuffix('자막 포함')).toBe('자막 포함')
    expect(cleanSuffix('../x')).toBe('..x')
    expect(cleanSuffix('')).toBe('captioned')
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

describe('validateVideoFiles', () => {
  const mp4 = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0])
  const ok = { plain: mp4, captioned: mp4, srt: '1\n', vtt: 'WEBVTT\n', captionedSuffix: '자막 포함' }

  it('accepts the set the exporter makes', () => {
    expect(validateVideoFiles(ok).captionedSuffix).toBe('자막 포함')
  })

  it('refuses anything that is not an MP4 or not text', () => {
    expect(() => validateVideoFiles({ ...ok, plain: new Uint8Array(20) })).toThrow()
    expect(() => validateVideoFiles({ ...ok, srt: 5 })).toThrow()
    expect(() => validateVideoFiles(null)).toThrow()
  })
})
