// jsdom has no IndexedDB, so this exercises the in-memory fallback — the same
// API a private window gets. The IndexedDB path is exercised in the app.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  MAX_SAVED_STAMPS, addStamp, customIdOf, customKey, listStamps, presetSize,
  rememberSize, removeStamp, resetStampLibraryForTests, type SavedStamp,
} from './stampLibrary'

const stamp = (id: string, createdAt: number): SavedStamp =>
  ({ id, name: `${id}.png`, src: 'data:image/png;base64,AA==', width: 72, height: 72, createdAt })

beforeEach(() => resetStampLibraryForTests())

describe('stamp library', () => {
  it('keeps uploaded stamps, newest first, and forgets one on request', async () => {
    await addStamp(stamp('a', 1))
    await addStamp(stamp('b', 2))
    expect((await listStamps()).map(s => s.id)).toEqual(['b', 'a'])
    await removeStamp('b')
    expect((await listStamps()).map(s => s.id)).toEqual(['a'])
  })

  it(`keeps at most ${MAX_SAVED_STAMPS}, dropping the oldest`, async () => {
    for (let i = 0; i <= MAX_SAVED_STAMPS; i++) await addStamp(stamp(`s${i}`, i))
    const ids = (await listStamps()).map(s => s.id)
    expect(ids).toHaveLength(MAX_SAVED_STAMPS)
    expect(ids).not.toContain('s0')
  })

  it('remembers the size a stamp was last given — custom and preset alike', async () => {
    await addStamp(stamp('seal', 1))
    await rememberSize(customKey('seal'), { width: 40, height: 40 })
    expect((await listStamps())[0]).toMatchObject({ width: 40, height: 40 })

    expect(await presetSize('approved')).toBeNull()
    await rememberSize('approved', { width: 150, height: 60 })
    expect(await presetSize('approved')).toEqual({ width: 150, height: 60 })
  })

  it('tells custom stamps from presets by key', () => {
    expect(customIdOf(customKey('x1'))).toBe('x1')
    expect(customIdOf('approved')).toBeNull()
    expect(customIdOf(undefined)).toBeNull()
  })
})
