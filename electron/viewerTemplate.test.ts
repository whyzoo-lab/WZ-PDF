// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  adoptTemplate, cachedTemplate, cachedTemplatePath, parseManifest, pruneOtherVersions, templateUrl,
  type TemplateManifest,
} from './viewerTemplate.ts'

const sha512 = (b: Buffer) => createHash('sha512').update(b).digest('base64')
const BYTES = Buffer.from('portable exe bytes')
const manifest: TemplateManifest = { version: '1.24.0', file: 'WZ_PDF_1.24.0.exe', size: BYTES.length, sha512: sha512(BYTES) }

describe('viewer-template.json', () => {
  it('is accepted for this version only', () => {
    const raw = JSON.stringify(manifest)
    expect(parseManifest(raw, '1.24.0')).toEqual(manifest)
    expect(parseManifest(raw, '1.25.0')).toBeNull()
  })

  it('refuses a file name that could point anywhere else, or a malformed hash', () => {
    for (const file of ['../evil.exe', 'C:\\Windows\\x.exe', 'WZ_PDF_1.24.0.exe/../../x.exe', 'other.exe']) {
      expect(parseManifest(JSON.stringify({ ...manifest, file }), '1.24.0'), file).toBeNull()
    }
    expect(parseManifest(JSON.stringify({ ...manifest, sha512: 'abc' }), '1.24.0')).toBeNull()
    expect(parseManifest(JSON.stringify({ ...manifest, size: -1 }), '1.24.0')).toBeNull()
    expect(parseManifest('not json', '1.24.0')).toBeNull()
  })

  it('downloads from this version’s GitHub release', () => {
    expect(templateUrl(manifest)).toBe('https://github.com/whyzoo-lab/WZ-PDF/releases/download/v1.24.0/WZ_PDF_1.24.0.exe')
  })
})

describe('a template the reader picks', () => {
  let dir = ''
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-template-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('is kept when it is exactly this version’s portable', async () => {
    const picked = path.join(dir, 'picked.exe')
    fs.writeFileSync(picked, BYTES)
    expect(await cachedTemplate(dir, manifest)).toBeNull()
    const kept = await adoptTemplate(dir, manifest, picked)
    expect(kept).toBe(cachedTemplatePath(dir, manifest))
    expect(await cachedTemplate(dir, manifest)).toBe(kept)
  })

  it('is refused when its bytes differ, even at the same size', async () => {
    const picked = path.join(dir, 'other.exe')
    fs.writeFileSync(picked, Buffer.from('portable exe bytez'))
    await expect(adoptTemplate(dir, manifest, picked)).rejects.toThrow()
    expect(await cachedTemplate(dir, manifest)).toBeNull()
  })

  it('leaves no copy of an older version behind', async () => {
    const old = path.join(dir, 'viewer-template', 'WZ_PDF_1.23.0.exe')
    fs.mkdirSync(path.dirname(old), { recursive: true })
    fs.writeFileSync(old, 'old')
    await pruneOtherVersions(dir, manifest)
    expect(fs.existsSync(old)).toBe(false)
  })
})
