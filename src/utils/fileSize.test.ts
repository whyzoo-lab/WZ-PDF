import { describe, it, expect } from 'vitest'
import { formatSize } from './fileSize'

describe('formatSize', () => {
  it('counts bytes under a kilobyte as bytes', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1023)).toBe('1023 B')
  })

  it('rounds kilobytes and gives megabytes one decimal', () => {
    expect(formatSize(1024)).toBe('1 KB')
    expect(formatSize(860_000)).toBe('840 KB')
    expect(formatSize(4.1 * 1024 * 1024)).toBe('4.1 MB')
  })
})
