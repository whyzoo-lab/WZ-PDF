// @vitest-environment node
//
// Korean text written by the MCP tools must be drawn, not just extractable.
// @pdf-lib/fontkit's subsetter wrote a broken font program for Noto Sans KR:
// the text still copied out, but glyphs such as 계약서 painted as blank space.
// pdfjs reports that while parsing the font, so its warnings are the check.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from '@cantoo/pdf-lib'

const { callTool } = await import('./tools.js')
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

/**
 * pdfjs warnings printed while `work` runs. Captured with a spy at that moment:
 * vitest swaps the console per test, so a wrapper installed at module load
 * never sees them — which is how an earlier version of this check passed
 * against a broken font.
 */
async function pdfjsWarnings(work: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { if (String(a[0]).startsWith('Warning')) seen.push(String(a[0])) })
  const warn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { if (String(a[0]).startsWith('Warning')) seen.push(String(a[0])) })
  try { await work() } finally { log.mockRestore(); warn.mockRestore() }
  return seen
}

describe('Korean text from the MCP tools', () => {
  let dir = ''
  let input = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wzpdf-mcp-ko-'))
    input = join(dir, 'in.pdf')
    const doc = await PDFDocument.create(); doc.addPage([600, 400])
    await writeFile(input, await doc.save())
  })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  it('draws every glyph of a Korean watermark', async () => {
    const output = join(dir, 'marked.pdf')
    await callTool('pdf_add_watermark', { file: input, output, text: '대외비 계약서 Confidential' })
    const bytes = new Uint8Array(await readFile(output))
    let text = ''
    // The whole read, not just the drawing: pdfjs parses a font once, on first
    // use, and extracting the text is already a use.
    const warnings = await pdfjsWarnings(async () => {
      const page = await (await pdfjs.getDocument({ data: bytes }).promise).getPage(1)
      text = (await page.getTextContent()).items.map(i => ('str' in i ? i.str : '')).join('')
      await page.getOperatorList()
    })
    expect(text).toContain('대외비 계약서')
    expect(warnings).toEqual([])
  })
})
