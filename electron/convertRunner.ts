import fs from 'node:fs'
import path from 'node:path'
import {
  type ConverterSpec,
  expandInputs,
  isConvertible,
  outputPathFor,
  parseCliArgs,
  usageFor,
} from './cli'

/**
 * The batch driver behind every console converter.
 *
 * Expanding the inputs, the skip/overwrite rule, the per-file reporting and the
 * exit code are identical whatever the target format, so they live here once
 * and each converter supplies only a `ConversionBackend`. That is genuinely the
 * only thing that differs: HWP → PDF has to run in the app's Chromium because
 * the pages are composited from rendered canvases, while HWP ⇄ HWPX is a pure
 * WASM transform that needs no window at all.
 *
 * Output goes through `process.stdout.write` rather than console.log so it
 * survives being piped.
 */

export interface ConversionBackend {
  /**
   * One-time preparation, billed to nobody in particular.
   *
   * Kept separate from the first conversion on purpose: on a cold machine
   * loading the engine costs far more than any single document, and folding it
   * into file #1 makes that file look like the slow one — or time out.
   */
  warmup(): Promise<void>
  /** Convert one document to the target format's bytes. */
  convert(inputPath: string): Promise<Uint8Array>
  /** Always called, even when warmup threw. */
  dispose(): void
  warmupTimeoutMs: number
  perFileTimeoutMs: number
}

export const EXIT_OK = 0
export const EXIT_FAILED = 1
export const EXIT_USAGE = 2

function write(line: string): void {
  process.stdout.write(line + '\n')
}

function writeErr(line: string): void {
  process.stderr.write(line + '\n')
}

/**
 * Bound a wait.
 *
 * Every wait on the way to output has a deadline, without exception. An
 * unbounded one does not merely delay the batch: the process keeps running with
 * no window and no output, and the only way out is Task Manager. That has
 * happened in practice more than once.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    work.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
}

export async function runConversion(
  argv: readonly string[],
  spec: ConverterSpec,
  createBackend: () => ConversionBackend,
): Promise<number> {
  const { options, error } = parseCliArgs(argv, spec)

  if (error) {
    writeErr(error)
    writeErr('')
    writeErr(usageFor(spec))
    return EXIT_USAGE
  }
  if (options.help) {
    write(usageFor(spec))
    return EXIT_OK
  }

  const accepts = spec.sourceExts.map(ext => ext.toUpperCase()).join('/')
  const { files, unmatched } = expandInputs({
    inputs: options.inputs,
    spec,
    recurse: options.recurse,
  })
  for (const input of unmatched) writeErr(`No matching ${accepts} file: ${input}`)
  if (files.length === 0) return unmatched.length > 0 ? EXIT_FAILED : EXIT_USAGE

  if (options.outDir) {
    try {
      fs.mkdirSync(path.resolve(options.outDir), { recursive: true })
    } catch (err) {
      writeErr(`Cannot create output directory: ${(err as Error).message}`)
      return EXIT_FAILED
    }
  }

  let converted = 0
  let skipped = 0
  let failed = 0

  const backend = createBackend()
  try {
    await withTimeout(backend.warmup(), backend.warmupTimeoutMs, 'startup')

    for (const file of files) {
      const output = outputPathFor(file, options.outDir, spec)
      const name = path.basename(file.path)

      if (!isConvertible(file.path, spec)) {
        writeErr(`SKIP ${name} — not a ${accepts} file`)
        failed++
        continue
      }
      if (!options.force && fs.existsSync(output)) {
        if (!options.quiet) {
          write(`SKIP ${name} — ${path.basename(output)} exists (use -f to overwrite)`)
        }
        skipped++
        continue
      }

      try {
        const bytes = await withTimeout(backend.convert(file.path), backend.perFileTimeoutMs, name)
        if (bytes.length === 0) throw new Error('conversion produced no data')
        // Mirroring a source tree means the sub-folder may not exist yet.
        await fs.promises.mkdir(path.dirname(output), { recursive: true })
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
    backend.dispose()
  }

  if (!options.quiet) {
    write(`Done. ${converted} converted, ${skipped} skipped, ${failed} failed.`)
  }
  return failed > 0 ? EXIT_FAILED : EXIT_OK
}
