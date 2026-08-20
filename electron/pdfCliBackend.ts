import path from 'node:path'
import { BrowserWindow } from 'electron'
import type { ConversionBackend } from './convertRunner'

/**
 * HWP/HWPX → PDF, run in a window that is never shown.
 *
 * The conversion cannot happen in the main process: @rhwp/core renders into a
 * canvas and exportHwpToPdf composites those canvases. Driving the real
 * renderer is therefore not a workaround — it is what makes the console tool's
 * output identical to the GUI's Export → PDF, selectable text layer and
 * bundled Korean fonts included. See src/services/cliBridge.ts for the other
 * half.
 */

/** Loading the engine and the ~12 MB Korean fonts happens once, and on a cold
 *  machine takes far longer than any single conversion. */
const WARMUP_TIMEOUT_MS = 300_000
/** Give up on a single document rather than hanging the whole batch. */
const PER_FILE_TIMEOUT_MS = 120_000
/** How long the hidden page gets to load at all. */
const PAGE_LOAD_TIMEOUT_MS = 60_000
/** How long to wait for the page to publish its converter entry point. */
const BRIDGE_TIMEOUT_MS = 30_000

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    work.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
}

/**
 * Wait until the page has published `window.__wzCli`.
 *
 * `loadURL` resolves when the document has loaded, which is earlier than the
 * bridge exists: it is installed from a dynamic import so that a normal launch
 * never pays for it. Calling straight after loadURL therefore raced, and lost.
 */
async function waitForBridge(contents: Electron.WebContents): Promise<void> {
  for (;;) {
    const ready = await contents.executeJavaScript('typeof window.__wzCli === "object"')
    if (ready === true) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/**
 * `loadUrl` is injected so this can be pointed at the dev server; the window is
 * created here rather than reusing the app's own so nothing about the visible
 * app (menu, title bar, restore state) is involved.
 */
export function createPdfBackend(loadUrl: string): ConversionBackend {
  let win: BrowserWindow | null = null

  return {
    warmupTimeoutMs: PAGE_LOAD_TIMEOUT_MS + BRIDGE_TIMEOUT_MS + WARMUP_TIMEOUT_MS,
    perFileTimeoutMs: PER_FILE_TIMEOUT_MS,

    async warmup() {
      win = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          // Chromium suspends timers and rAF in an unshown window, which the
          // renderer's async decode paths wait on — the conversion would stall.
          backgroundThrottling: false,
        },
      })
      await withTimeout(win.loadURL(loadUrl), PAGE_LOAD_TIMEOUT_MS, 'page load')
      await withTimeout(waitForBridge(win.webContents), BRIDGE_TIMEOUT_MS, 'converter startup')
      await withTimeout(
        win.webContents.executeJavaScript('window.__wzCli.warmup()'),
        WARMUP_TIMEOUT_MS,
        'startup',
      )
    },

    async convert(inputPath) {
      if (!win) throw new Error('converter is not running')
      const base64 = await win.webContents.executeJavaScript(
        `window.__wzCli.convert(${JSON.stringify(inputPath)})`,
      ) as string
      return Buffer.from(base64, 'base64')
    },

    dispose() {
      win?.destroy()
      win = null
    },
  }
}
