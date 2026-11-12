// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument } from '@cantoo/pdf-lib'
import { callTool, tools } from './tools.js'

/**
 * A tool that writes must not destroy a file it was pointed at. Text an agent
 * reads out of a PDF is attacker-controlled; "save the result over the user's
 * thesis.docx" must fail rather than silently replace it.
 */
describe('where tools may write', () => {
  let dir = ''
  let input = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wzpdf-mcp-test-'))
    input = join(dir, 'in.pdf')
    const doc = await PDFDocument.create(); doc.addPage()
    await writeFile(input, await doc.save())
  })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  it('writes a new .pdf', async () => {
    await expect(callTool('pdf_insert_blank', { file: input, output: join(dir, 'new.pdf'), afterPage: 0 })).resolves.toMatch(/new\.pdf/)
  })

  it('refuses to replace an existing file unless asked', async () => {
    const victim = join(dir, 'keep.pdf')
    await writeFile(victim, 'precious')
    await expect(callTool('pdf_insert_blank', { file: input, output: victim, afterPage: 0 })).rejects.toThrow(/already exists/)
    expect(await readFile(victim, 'utf8')).toBe('precious')
    await expect(callTool('pdf_insert_blank', { file: input, output: victim, afterPage: 0, overwrite: true })).resolves.toMatch(/keep\.pdf/)
  })

  it('refuses outputs that are not PDFs', async () => {
    const doc = join(dir, 'thesis.docx')
    await writeFile(doc, 'my thesis')
    await expect(callTool('pdf_insert_blank', { file: input, output: doc, afterPage: 0, overwrite: true })).rejects.toThrow(/\.pdf/)
    expect(await readFile(doc, 'utf8')).toBe('my thesis')
  })

  // NTFS: "thesis.docx:a.pdf" ends in .pdf and names a hidden stream of thesis.docx.
  it.runIf(process.platform === 'win32')('refuses an alternate data stream of another file', async () => {
    const doc = join(dir, 'paper.docx')
    await writeFile(doc, 'my paper')
    await expect(callTool('pdf_insert_blank', { file: input, output: `${doc}:a.pdf`, afterPage: 0 })).rejects.toThrow(/invalid output path/)
  })

  // Touching \\host\share opens an SMB session before anything else is checked.
  it.runIf(process.platform === 'win32')('refuses network paths, in and out', async () => {
    await expect(callTool('pdf_insert_blank', { file: '\\\\wz-no-such-host.invalid\\share\\in.pdf', output: join(dir, 'unc.pdf'), afterPage: 0 })).rejects.toThrow(/UNC/)
    await expect(callTool('pdf_insert_blank', { file: input, output: '\\\\wz-no-such-host.invalid\\share\\out.pdf', afterPage: 0 })).rejects.toThrow(/UNC/)
  })

  it('splits a range far past the last page without walking it', async () => {
    const started = performance.now()
    await callTool('pdf_split', { file: input, outputDir: dir, ranges: '1-99999999999', overwrite: true })
    expect(performance.now() - started).toBeLessThan(5000)
  })

  it('advertises overwrite on every tool that writes', () => {
    for (const t of tools) {
      const props = t.inputSchema.properties as Record<string, unknown>
      if ('output' in props || 'outputDir' in props) expect(props).toHaveProperty('overwrite')
    }
  })
})
