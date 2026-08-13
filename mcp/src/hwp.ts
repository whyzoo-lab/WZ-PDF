import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * HWP/HWPX → PDF for the MCP server.
 *
 * The conversion cannot happen in this process. `@rhwp/core` renders into a
 * canvas and the PDF is composited from those canvases, so it needs the
 * desktop app's Chromium — the same reason the `hwp2pdf` console tool is a
 * launcher rather than a converter. This delegates to that same headless path,
 * so an agent gets exactly the file the GUI's Export → PDF produces, selectable
 * text layer and bundled Korean fonts included.
 */

/** The app is a GUI binary; a conversion of a large document can take a while. */
const CONVERT_TIMEOUT_MS = 180_000
const APP_EXE = 'WZ PDF.exe'

/**
 * Locate the desktop app.
 *
 * Shipped, the server sits in `<install>/resources/mcp/`, so the app is two
 * levels up. `WZPDF_APP` overrides that for development and for unusual
 * installs, and is checked first so a wrong guess can always be corrected
 * without reinstalling.
 */
export function findAppExecutable(fromDir: string, exists: (p: string) => boolean = existsSync): string {
  const override = process.env.WZPDF_APP
  if (override) {
    if (!exists(override)) throw new Error(`WZPDF_APP does not exist: ${override}`)
    return override
  }
  const candidates = [
    resolve(fromDir, '..', '..', APP_EXE),   // <install>/resources/mcp -> <install>
    resolve(fromDir, '..', APP_EXE),
    resolve(fromDir, APP_EXE),
  ]
  const found = candidates.find(exists)
  if (!found) {
    throw new Error(
      `Cannot find "${APP_EXE}". Install WZ PDF, or set WZPDF_APP to its full path.`,
    )
  }
  return found
}

/** `report.hwpx` -> `report.pdf`, keeping any dots in the name. */
export function pdfNameFor(inputPath: string): string {
  return basename(inputPath, extname(inputPath)) + '.pdf'
}

function runApp(exe: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  // ELECTRON_RUN_AS_NODE must not reach the child. The shipped server is itself
  // started through the app binary with that variable set (it is how the server
  // runs without a separate Node install), and a child inheriting it would boot
  // the app as plain Node, which rejects --hwp2pdf as a bad option.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  return new Promise(resolve_ => {
    execFile(exe, args, { timeout: CONVERT_TIMEOUT_MS, windowsHide: true, env }, (error, stdout, stderr) => {
      const code = error && typeof (error as NodeJS.ErrnoException & { code?: number }).code === 'number'
        ? Number((error as unknown as { code: number }).code)
        : error ? 1 : 0
      resolve_({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

export interface ConvertResult {
  outputPath: string
  bytes: number
}

/**
 * Convert one document and place the PDF at `outputPath`.
 *
 * The CLI names its output after the input, so the conversion runs into a
 * temporary directory and the result is moved. That keeps one code path for
 * both "next to the input" and "somewhere specific", and means a failed run
 * never leaves a half-written file at the destination.
 */
export async function convertHwpToPdf(
  inputPath: string,
  outputPath: string,
  serverDir = dirname(fileURLToPath(import.meta.url)),
): Promise<ConvertResult> {
  const exe = findAppExecutable(serverDir)
  const scratch = await mkdtemp(join(tmpdir(), 'wzpdf-mcp-'))
  try {
    const run = await runApp(exe, ['--hwp2pdf', inputPath, '-o', scratch, '-f', '-q'])
    const produced = (await readdir(scratch)).filter(name => name.toLowerCase().endsWith('.pdf'))
    if (produced.length === 0) {
      const detail = (run.stderr || run.stdout).trim().split('\n').slice(-3).join(' ')
      throw new Error(`conversion failed${detail ? `: ${detail}` : ` (exit ${run.code})`}`)
    }
    await rename(join(scratch, produced[0]), outputPath)
    return { outputPath, bytes: (await stat(outputPath)).size }
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined)
  }
}
