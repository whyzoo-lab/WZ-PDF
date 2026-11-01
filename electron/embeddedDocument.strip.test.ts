// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildTrailer, stripEmbedded } from './embeddedDocument'

function exeWith(...docs: Array<[string, string]>): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wz-strip-')), 'viewer.exe')
  fs.writeFileSync(file, 'MZ-the-app')
  for (const [name, body] of docs) {
    const bytes = Buffer.from(body)
    fs.appendFileSync(file, bytes)
    fs.appendFileSync(file, buildTrailer(name, bytes.byteLength))
  }
  return file
}

describe('stripEmbedded', () => {
  it('leaves a plain exe alone', async () => {
    const file = exeWith()
    await stripEmbedded(file)
    expect(fs.readFileSync(file, 'utf8')).toBe('MZ-the-app')
  })

  it('removes the carried document', async () => {
    const file = exeWith(['계약서.pdf', '%PDF-secret'])
    await stripEmbedded(file)
    expect(fs.readFileSync(file, 'utf8')).toBe('MZ-the-app')
  })

  it('removes every layer an earlier export left behind', async () => {
    const file = exeWith(['첫째.pdf', '%PDF-first'], ['둘째.pdf', '%PDF-second'])
    await stripEmbedded(file)
    expect(fs.readFileSync(file, 'utf8')).toBe('MZ-the-app')
  })
})
