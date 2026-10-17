import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { RecoveryStore, isRecoveryRecord, type RecoveryRecord } from './recovery'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-recovery-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

const record = (key: string, over: Partial<RecoveryRecord> = {}): RecoveryRecord => ({
  key, name: 'report.pdf', path: path.resolve('/docs/report.pdf'), modified: false,
  annotations: [{ id: 'a1', type: 'stamp', page: 2 }], ...over,
})
const bytes = (s: string) => new TextEncoder().encode(s)

describe('recovery store', () => {
  it('offers what a crashed process left, and not what a running one is writing', async () => {
    // Process 111 crashed (not alive); 222 is another running copy; 333 is us.
    const alive = (pid: number) => pid === 222
    await new RecoveryStore(dir, 111, alive).write(record('crashed-entry'), bytes('%PDF crashed'))
    await new RecoveryStore(dir, 222, alive).write(record('live-entry-1'), bytes('%PDF live'))
    const us = new RecoveryStore(dir, 333, alive)
    await us.write(record('our-own-entry'), bytes('%PDF ours'))
    expect((await us.list()).map(e => e.key)).toEqual(['crashed-entry'])
  })

  it('returns the bytes and the annotations to reopen an entry', async () => {
    const store = new RecoveryStore(dir, 111, () => false)
    await store.write(record('entry-0001', { modified: true }), bytes('%PDF edited'))
    const got = await new RecoveryStore(dir, 999, () => false).read('entry-0001')
    expect(new TextDecoder().decode(got!.body!)).toBe('%PDF edited')
    expect(got!.entry.modified).toBe(true)
    expect(got!.entry.annotations).toEqual([{ id: 'a1', type: 'stamp', page: 2 }])
  })

  it('keeps the bytes already written when only the annotations changed', async () => {
    const store = new RecoveryStore(dir, 111, () => false)
    await store.write(record('entry-0002'), bytes('%PDF once'))
    await store.write(record('entry-0002', { annotations: [] }), null)
    const got = await store.read('entry-0002')
    expect(new TextDecoder().decode(got!.body!)).toBe('%PDF once')
    expect(got!.entry.annotations).toEqual([])
  })

  it('leaves no temporary files behind', async () => {
    const store = new RecoveryStore(dir, 111, () => false)
    await store.write(record('entry-0003'), bytes('%PDF'))
    expect(fs.readdirSync(dir).sort()).toEqual(['entry-0003.bin', 'entry-0003.json'])
  })

  it('removes its own entries on a normal quit, and only those', async () => {
    const alive = () => false
    await new RecoveryStore(dir, 111, alive).write(record('somebody-else'), bytes('%PDF'))
    const us = new RecoveryStore(dir, 333, alive)
    await us.write(record('our-own-entry'), bytes('%PDF'))
    us.removeOwnSync()
    expect(fs.readdirSync(dir).sort()).toEqual(['somebody-else.bin', 'somebody-else.json'])
  })

  it('discards leftovers but not a running copy\'s entries', async () => {
    const alive = (pid: number) => pid === 222
    await new RecoveryStore(dir, 111, alive).write(record('crashed-entry'), bytes('%PDF'))
    await new RecoveryStore(dir, 222, alive).write(record('live-entry-1'), bytes('%PDF'))
    await new RecoveryStore(dir, 333, alive).discardLeftovers()
    expect(fs.readdirSync(dir).sort()).toEqual(['live-entry-1.bin', 'live-entry-1.json'])
  })

  it('skips damaged records instead of failing', async () => {
    fs.writeFileSync(path.join(dir, 'broken-entry.json'), '{ not json')
    await new RecoveryStore(dir, 111, () => false).write(record('good-entry1'), bytes('%PDF'))
    expect((await new RecoveryStore(dir, 999, () => false).list()).map(e => e.key)).toEqual(['good-entry1'])
  })

  it('refuses keys and names that could leave the folder', () => {
    expect(isRecoveryRecord(record('../../evil'))).toBe(false)
    expect(isRecoveryRecord(record('good-key-1', { name: '..\\x.pdf' }))).toBe(false)
    expect(isRecoveryRecord(record('good-key-1', { path: 'relative/x.pdf' }))).toBe(false)
    expect(isRecoveryRecord(record('good-key-1'))).toBe(true)
  })
})
