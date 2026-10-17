import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { cleanAuthor, readCommentAuthor, writeCommentAuthor } from './commentAuthor'

describe('comment author', () => {
  it('cleans what the renderer sends', () => {
    expect(cleanAuthor('  김철수\n ')).toBe('김철수')
    expect(cleanAuthor(42)).toBe('')
    expect(cleanAuthor('x'.repeat(100))).toHaveLength(64)
  })

  it('starts as the account name and keeps what was set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-author-'))
    try {
      expect(readCommentAuthor(dir)).toBe(cleanAuthor(os.userInfo().username))
      expect(writeCommentAuthor(dir, '이영희')).toBe('이영희')
      expect(readCommentAuthor(dir)).toBe('이영희')
      // Cleared: back to the account name.
      writeCommentAuthor(dir, '')
      expect(readCommentAuthor(dir)).toBe(cleanAuthor(os.userInfo().username))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
