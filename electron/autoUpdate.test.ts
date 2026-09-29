import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, ipcMain: { handle: vi.fn() } }))
const { canAutoUpdate, parseUpdateSettings } = await import('./autoUpdate.ts')

const installed = { isPackaged: true, platform: 'win32' as const, portableExe: undefined, hasUpdateConfig: true }

describe('canAutoUpdate', () => {
  it('updates the installed app', () => {
    expect(canAutoUpdate(installed)).toBe(true)
  })

  it('never updates the portable exe or a viewer exe made from it', () => {
    expect(canAutoUpdate({ ...installed, portableExe: 'C:\\Users\\me\\Desktop\\contract.exe' })).toBe(false)
  })

  it('never updates a development run or a build without update config', () => {
    expect(canAutoUpdate({ ...installed, isPackaged: false })).toBe(false)
    expect(canAutoUpdate({ ...installed, hasUpdateConfig: false })).toBe(false)
    expect(canAutoUpdate({ ...installed, platform: 'darwin' })).toBe(false)
  })
})

describe('parseUpdateSettings', () => {
  it('is on until the reader turns it off', () => {
    expect(parseUpdateSettings(null)).toEqual({ enabled: true })
    expect(parseUpdateSettings('{"enabled":false}')).toEqual({ enabled: false })
    expect(parseUpdateSettings('{"enabled":true}')).toEqual({ enabled: true })
  })

  it('does not switch updates off because the file is damaged', () => {
    expect(parseUpdateSettings('not json')).toEqual({ enabled: true })
    expect(parseUpdateSettings('null')).toEqual({ enabled: true })
  })
})
