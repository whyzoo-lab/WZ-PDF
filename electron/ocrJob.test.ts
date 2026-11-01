import { describe, it, expect } from 'vitest'
import { parseOcrRequest } from './ocrJob'
import { hasCliFlag, cliToolName } from './cliRunner'

describe('parseOcrRequest', () => {
  it('reads what the MCP server writes', () => {
    const json = JSON.stringify({ files: [
      { path: 'C:\\a.pdf', pages: [2, 3], mode: 'images', maxPages: 5 },
      { path: 'C:\\b.png', mode: 'auto' },
    ] })
    expect(parseOcrRequest(json)).toEqual([
      { path: 'C:\\a.pdf', pages: [2, 3], mode: 'images', maxPages: 5 },
      { path: 'C:\\b.png', mode: 'auto' },
    ])
  })

  it('refuses anything malformed before a window opens', () => {
    expect(() => parseOcrRequest('{}')).toThrow(/files/)
    expect(() => parseOcrRequest('{"files":[{"mode":"auto"}]}')).toThrow(/path/)
    expect(() => parseOcrRequest('{"files":[{"path":"a","mode":"all"}]}')).toThrow(/mode/)
    expect(() => parseOcrRequest('{"files":[{"path":"a","mode":"auto","pages":["1"]}]}')).toThrow(/pages/)
    expect(() => parseOcrRequest('{"files":[{"path":"a","mode":"auto","maxPages":0}]}')).toThrow(/maxPages/)
  })

  it('is started through the console-converter path, under its own name', () => {
    const argv = ['WZ PDF.exe', '--ocr-json', 'req.json', 'res.json']
    expect(hasCliFlag(argv)).toBe(true)
    expect(cliToolName(argv)).toBe('wz ocr')
  })
})
