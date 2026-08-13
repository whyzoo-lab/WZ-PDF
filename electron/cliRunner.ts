import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import {
  CLI_FLAG,
  USAGE,
  expandInputs,
  isConvertible,
  outputPathFor,
  parseCliArgs,
} from './cli'

/**
 * Main-process half of the `hwp2pdf` console tool.
 *
 * Runs the real renderer in a window that is never shown, because that is where
 * the conversion lives (see services/cliBridge.ts). Output goes to stdout with
 * `process.stdout.write` rather than console.log so it survives being piped.
 */

export function hasCliFlag(argv: readonly string[]): boolean {
  return argv.includes(CLI_FLAG)
}

const EXIT_OK = 0
const EXIT_FAILED = 1
const EXIT_USAGE = 2

/** Give up on a single document rather than hanging the whole batch. */
const PER_FILE_TIMEOUT_MS = 120_000
/** Loading the engine and the ~12 MB Korean fonts happens once, and on a cold
 *  machine takes far longer than any single conversion. */
const WARMUP_TIMEOUT_MS = 300_000
/** How long to wait for the page to publish its converter entry point. */
const BRIDGE_TIMEOUT_MS = 30_000
/** How long the hidden page gets to load at all. */
const PAGE_LOAD_TIMEOUT_MS = 60_000

function write(line: string): void {
  process.stdout.write(line + '\n')
}

function writeErr(line: string): void {
  process.stderr.write(line + '\n')
}

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
 * Convert every requested document. Returns the process exit code.
 *
 * `loadUrl` is injected so this can be pointed at the dev server; the window is
 * created here rather than reusing the app's own so nothing about the visible
 * app (menu, title bar, restore state) is involved.
 */
export async function runCli(argv: readonly string[], loadUrl: string): Promise<number> {
  const { options, error } = parseCliArgs(argv)

  if (error) {
    writeErr(error)
    writeErr('')
    writeErr(USAGE)
    return EXIT_USAGE
  }
  if (options.help) {
    write(USAGE)
    return EXIT_OK
  }

  const { files, unmatched } = expandInputs(options.inputs)
  for (const pattern of unmatched) writeErr(`No matching HWP/HWPX file: ${pattern}`)
  if (files.length === 0) return unmatched.length > 0 ? EXIT_FAILED : EXIT_USAGE

  if (options.outDir) {
    try {
      fs.mkdirSync(path.resolve(options.outDir), { recursive: true })
    } catch (err) {
      writeErr(`Cannot create output directory: ${(err as Error).message}`)
      return EXIT_FAILED
    }
  }

  const win = new BrowserWindow({
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

  let failed = 0
  let converted = 0
  let skipped = 0

  try {
    // Every wait here is bounded. An unbounded one does not just delay the
    // batch: the process keeps running with no output and no window, and the
    // only way out is Task Manager. Both of these have hung in practice.
    await withTimeout(win.loadURL(loadUrl), PAGE_LOAD_TIMEOUT_MS, 'page load')
    await withTimeout(waitForBridge(win.webContents), BRIDGE_TIMEOUT_MS, 'converter startup')
    await withTimeout(
      win.webContents.executeJavaScript('window.__wzCli.warmup()'),
      WARMUP_TIMEOUT_MS,
      'startup',
    )

    for (const input of files) {
      const output = outputPathFor(input, options.outDir)
      const name = path.basename(input)

      if (!isConvertible(input)) {
        writeErr(`SKIP ${name} — not a HWP/HWPX file`)
        failed++
        continue
      }
      if (!options.force && fs.existsSync(output)) {
        if (!options.quiet) write(`SKIP ${name} — ${path.basename(output)} exists (use -f to overwrite)`)
        skipped++
        continue
      }

      try {
        const base64 = await withTimeout(
          win.webContents.executeJavaScript(`window.__wzCli.convert(${JSON.stringify(input)})`),
          PER_FILE_TIMEOUT_MS,
          name,
        ) as string
        const bytes = Buffer.from(base64, 'base64')
        if (bytes.length === 0) throw new Error('conversion produced no data')
        await fs.promises.writeFile(output, bytes)
        converted++
        if (!options.quiet) {
          write(`OK   ${name} -> ${output} (${(bytes.length / 1024).toFixed(0)} KB)`)
        }
      } catch (err) {
        failed++
        writeErr(`FAIL ${name} — ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    writeErr(`Could not start the converter: ${err instanceof Error ? err.message : String(err)}`)
    return EXIT_FAILED
  } finally {
    win.destroy()
  }

  if (!options.quiet) {
    write(`Done. ${converted} converted, ${skipped} skipped, ${failed} failed.`)
  }
  return failed > 0 ? EXIT_FAILED : EXIT_OK
}
