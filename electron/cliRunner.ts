import { converterFor } from './cli'
import { EXIT_USAGE, runConversion } from './convertRunner'
import { createHwpxBackend } from './hwpxCliBackend'
import { createPdfBackend } from './pdfCliBackend'
import { OCR_JOB_FLAG, runOcrJob } from './ocrJob'

/**
 * Entry point for every console converter — `hwp2pdf`, `hwp2hwpx`, `hwpx2hwp`.
 *
 * Each is a tiny console-subsystem launcher (cli/wzconvert.cs) that starts this
 * app with its own name as a switch, purely so the conversion has a console to
 * write to: `WZ PDF.exe` is a GUI-subsystem binary and its output would
 * otherwise vanish. The switch decides which backend runs; everything else is
 * shared (convertRunner.ts).
 */

export function hasCliFlag(argv: readonly string[]): boolean {
  return converterFor(argv) !== null || argv.includes(OCR_JOB_FLAG)
}

export async function runCli(argv: readonly string[], loadUrl: string): Promise<number> {
  // The MCP server's OCR: not a converter, but the same hidden-window path.
  if (argv.includes(OCR_JOB_FLAG)) return runOcrJob(argv, loadUrl)
  const spec = converterFor(argv)
  if (!spec) return EXIT_USAGE

  // PDF is the one target that needs the renderer, because its pages are
  // composited from rendered canvases. HWP ⇄ HWPX is pure WASM.
  const createBackend = spec.targetExt === 'pdf'
    ? () => createPdfBackend(loadUrl)
    : () => createHwpxBackend(spec)

  return runConversion(argv, spec, createBackend)
}

/** The tool name to blame in a top-level failure message. */
export function cliToolName(argv: readonly string[]): string {
  if (argv.includes(OCR_JOB_FLAG)) return 'wz ocr'
  return converterFor(argv)?.name ?? 'wz convert'
}
