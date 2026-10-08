/**
 * Automatic updates for the installed (NSIS) app, from GitHub Releases.
 *
 * electron-updater reads `latest.yml` from the newest release, downloads the
 * installer in the background, checks it against the sha512 in that file, and
 * runs it — silently, then relaunching — either when the reader clicks
 * "restart to update" or, failing that, when the app next quits.
 *
 * Only the installed app updates itself. The portable exe (and every viewer
 * exe exported from it) re-extracts itself on each launch and has nowhere to
 * install to, and a development run has no release to compare against.
 * `app-update.yml` — written into resources/ by electron-builder when the
 * config has a `publish` entry — is the last gate: an unpacked build without
 * it would only log errors.
 *
 * Checking contacts github.com and nothing about any document is sent; the
 * reader can still turn it off (start screen), and the choice is kept in
 * userData beside the recent-files list.
 */
import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { AppUpdater } from 'electron-updater'

const loadModule = createRequire(__filename)

/** Leave launch alone: the first check waits until the app has settled. */
export const FIRST_CHECK_DELAY_MS = 15_000
/** A window left open for days still hears about a release. */
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

export interface UpdateEnvironment {
  isPackaged: boolean
  platform: NodeJS.Platform
  /** PORTABLE_EXECUTABLE_FILE — set for the portable exe and every viewer exe. */
  portableExe: string | undefined
  /** Whether resources/app-update.yml exists. */
  hasUpdateConfig: boolean
}

/** Whether this copy of the app can update itself at all. */
export function canAutoUpdate(env: UpdateEnvironment): boolean {
  return env.isPackaged && env.platform === 'win32' && !env.portableExe && env.hasUpdateConfig
}

export interface UpdateSettings { enabled: boolean }

/** On unless the reader turned it off; a damaged file does not silently disable it. */
export function parseUpdateSettings(raw: string | null): UpdateSettings {
  if (!raw) return { enabled: true }
  try {
    const value = JSON.parse(raw) as { enabled?: unknown } | null
    return { enabled: value?.enabled !== false }
  } catch {
    return { enabled: true }
  }
}

/** What the renderer is told. */
export interface UpdateState {
  /** False for the portable exe, a viewer exe and development runs. */
  supported: boolean
  enabled: boolean
  /** Version downloaded and waiting to be installed, or null. */
  ready: string | null
  /** The running version. */
  current: string
}

let updater: AppUpdater | null = null
let supported = false
let settings: UpdateSettings = { enabled: true }
let ready: string | null = null
let timer: ReturnType<typeof setInterval> | null = null
let firstCheck: ReturnType<typeof setTimeout> | null = null
let getWindow: () => BrowserWindow | null = () => null

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'auto-update.json')
}

function readSettings(): UpdateSettings {
  try {
    return parseUpdateSettings(fs.readFileSync(settingsPath(), 'utf8'))
  } catch {
    return parseUpdateSettings(null)
  }
}

function state(): UpdateState {
  return { supported, enabled: settings.enabled, ready, current: app.getVersion() }
}

function loadUpdater(): AppUpdater {
  if (updater) return updater
  // Loaded only here, so a portable or development run never evaluates it.
  // require, not import(): from inside app.asar, Node's ESM loader does not
  // find this CommonJS package's getter-defined exports, and `autoUpdater`
  // came back undefined — only in the packaged app.
  const { autoUpdater } = loadModule('electron-updater') as typeof import('electron-updater')
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = settings.enabled
  // Its default logger is the console at info level — a line per check.
  autoUpdater.logger = {
    info: () => {},
    debug: () => {},
    warn: (m: unknown) => console.warn('[WZ Reader] update:', m),
    error: (m: unknown) => console.error('[WZ Reader] update:', m),
  }
  autoUpdater.on('error', err => console.error('[WZ Reader] update failed:', err instanceof Error ? err.message : String(err)))
  autoUpdater.on('update-downloaded', info => {
    ready = info.version
    getWindow()?.webContents.send('update:ready', info.version)
  })
  updater = autoUpdater
  return autoUpdater
}

async function check(): Promise<void> {
  if (!supported || !settings.enabled || ready) return
  try {
    const u = loadUpdater()
    await u.checkForUpdates()
  } catch (err) {
    // Offline, GitHub unreachable, rate-limited: try again at the next interval.
    console.error('[WZ Reader] update check failed:', err instanceof Error ? err.message : String(err))
  }
}

function schedule(): void {
  stopChecks()
  if (!supported || !settings.enabled) return
  firstCheck = setTimeout(() => { void check() }, FIRST_CHECK_DELAY_MS)
  timer = setInterval(() => { void check() }, CHECK_INTERVAL_MS)
}

function stopChecks(): void {
  if (firstCheck) clearTimeout(firstCheck)
  if (timer) clearInterval(timer)
  firstCheck = null
  timer = null
}

/** Start checking, if this copy can update itself. Call once, after the window exists. */
export function startAutoUpdate(window: () => BrowserWindow | null): void {
  getWindow = window
  supported = canAutoUpdate({
    isPackaged: app.isPackaged,
    platform: process.platform,
    portableExe: process.env['PORTABLE_EXECUTABLE_FILE'],
    hasUpdateConfig: fs.existsSync(path.join(process.resourcesPath, 'app-update.yml')),
  })
  if (!supported) return
  settings = readSettings()
  schedule()
}

/** IPC for the renderer: state, the on/off switch, and "restart to update". */
export function registerUpdateIpc(assertTrustedSender: (event: IpcMainInvokeEvent) => void): void {
  ipcMain.handle('update:state', event => {
    assertTrustedSender(event)
    return state()
  })

  ipcMain.handle('update:set-enabled', async (event, enabled: unknown) => {
    assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new Error('Invalid setting')
    if (!supported) return state()
    settings = { enabled }
    await fs.promises.writeFile(settingsPath(), JSON.stringify(settings))
    // Off also means a downloaded update is no longer installed on quit.
    if (updater) updater.autoInstallOnAppQuit = enabled
    schedule()
    return state()
  })

  ipcMain.handle('update:install', event => {
    assertTrustedSender(event)
    if (!updater || !ready) return false
    // Silent, then relaunch. The renderer has already dealt with unsaved
    // changes: the installer is started before the app quits, and it closes
    // the app itself, so a quit cancelled at this point would not save anything.
    updater.quitAndInstall(true, true)
    return true
  })
}
