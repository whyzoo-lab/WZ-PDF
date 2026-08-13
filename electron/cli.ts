import fs from 'node:fs'
import path from 'node:path'

/**
 * Argument handling for the `hwp2pdf` console tool.
 *
 * Kept free of Electron and of any I/O beyond one directory listing, so the
 * parts that are easy to get wrong — wildcard matching, output paths, the
 * skip/overwrite rule — are unit-testable without launching the app.
 *
 * Windows does not expand wildcards for a program the way a Unix shell does:
 * `hwp2pdf *.hwp` arrives literally as the string `*.hwp`. Expanding it is
 * therefore the tool's job, not a nicety.
 */

export const CLI_FLAG = '--hwp2pdf'

export interface CliOptions {
  /** Literal paths and wildcard patterns, in the order given. */
  inputs: string[]
  /** Write PDFs here instead of beside each input. */
  outDir: string | null
  /** Overwrite an existing PDF instead of skipping it. */
  force: boolean
  /** Only report failures. */
  quiet: boolean
  /** Print usage and exit. */
  help: boolean
}

export interface CliParseResult {
  options: CliOptions
  /** Set when the arguments cannot be used as given. */
  error: string | null
}

export const USAGE = [
  'hwp2pdf — convert HWP/HWPX documents to PDF',
  '',
  '  hwp2pdf [options] <file|pattern>...',
  '',
  '  Wildcards * and ? are expanded by the tool itself, because Windows hands',
  '  them to a program unexpanded:',
  '    hwp2pdf *.hwp',
  '    hwp2pdf reports/2026-??-*.hwpx',
  '    hwp2pdf a.hwp b.hwpx -o out',
  '',
  'Options:',
  '  -o, --out <dir>   write PDFs to <dir> (default: beside each input)',
  '  -f, --force       overwrite an existing PDF (default: skip it)',
  '  -q, --quiet       only report failures',
  '  -h, --help        show this help',
  '',
  'Exit codes: 0 all converted, 1 one or more failed, 2 bad arguments.',
].join('\n')

export function parseCliArgs(argv: readonly string[]): CliParseResult {
  const options: CliOptions = { inputs: [], outDir: null, force: false, quiet: false, help: false }

  // Only what follows the flag is ours. Everything before it belongs to the
  // process launch — argv[0] is the executable, and in development argv[1] is
  // the app directory — and treating those as documents made every run report
  // failures (and a non-zero exit) even when every file converted.
  const flagAt = argv.indexOf(CLI_FLAG)
  const args = flagAt === -1 ? argv : argv.slice(flagAt + 1)

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-h' || arg === '--help') { options.help = true; continue }
    if (arg === '-f' || arg === '--force') { options.force = true; continue }
    if (arg === '-q' || arg === '--quiet') { options.quiet = true; continue }
    if (arg === '-o' || arg === '--out') {
      const next = args[i + 1]
      if (next === undefined || next.startsWith('-')) {
        return { options, error: `${arg} needs a directory` }
      }
      options.outDir = next
      i++
      continue
    }
    if (arg.startsWith('-') && arg.length > 1) {
      return { options, error: `Unknown option: ${arg}` }
    }
    options.inputs.push(arg)
  }

  if (!options.help && options.inputs.length === 0) {
    return { options, error: 'No input files given' }
  }
  return { options, error: null }
}

/** The extensions the converter accepts, lower-cased and without the dot. */
const CONVERTIBLE = ['hwp', 'hwpx']

export function isConvertible(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase().slice(1)
  return CONVERTIBLE.includes(ext)
}

/**
 * Match one file name against a `*` / `?` pattern, case-insensitively.
 *
 * Written as a direct matcher rather than by translating to a RegExp: every
 * character of a real file name would otherwise have to be escaped correctly,
 * and a name like `report(final).hwp` becoming a pattern of its own is exactly
 * the kind of bug that only shows up on someone else's files. Backtracking is
 * bounded by remembering the last `*` instead of recursing.
 */
export function matchesWildcard(name: string, pattern: string): boolean {
  const text = name.toLowerCase()
  const pat = pattern.toLowerCase()

  let t = 0
  let p = 0
  let starAt = -1
  let matchAt = 0

  while (t < text.length) {
    if (p < pat.length && (pat[p] === '?' || pat[p] === text[t])) {
      t++; p++
    } else if (p < pat.length && pat[p] === '*') {
      starAt = p++
      matchAt = t
    } else if (starAt !== -1) {
      // Mismatch after a `*` — let the star swallow one more character.
      p = starAt + 1
      t = ++matchAt
    } else {
      return false
    }
  }
  while (p < pat.length && pat[p] === '*') p++
  return p === pat.length
}

export function hasWildcard(value: string): boolean {
  return value.includes('*') || value.includes('?')
}

export interface ExpandResult {
  files: string[]
  /** Patterns and paths that matched nothing, for a useful error message. */
  unmatched: string[]
}

/**
 * Turn the given paths and patterns into a de-duplicated list of file paths.
 *
 * Wildcards are honoured in the last path segment only. A pattern that expands
 * to nothing is reported rather than silently dropped — printing nothing is the
 * worst possible answer to `hwp2pdf *.hwp` run in the wrong folder.
 */
export function expandInputs(
  inputs: readonly string[],
  readDir: (dir: string) => string[] = dir => fs.readdirSync(dir),
): ExpandResult {
  const files: string[] = []
  const unmatched: string[] = []
  const seen = new Set<string>()

  const add = (filePath: string) => {
    const resolved = path.resolve(filePath)
    const key = resolved.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    files.push(resolved)
  }

  for (const input of inputs) {
    if (!hasWildcard(input)) {
      // A literal path is taken as given; whether it opens is reported later,
      // with the real filesystem error rather than a guess.
      add(input)
      continue
    }

    const dir = path.dirname(input) || '.'
    const pattern = path.basename(input)
    let entries: string[]
    try {
      entries = readDir(dir)
    } catch {
      unmatched.push(input)
      continue
    }
    const hits = entries
      .filter(name => isConvertible(name) && matchesWildcard(name, pattern))
      .sort((a, b) => a.localeCompare(b))
    if (hits.length === 0) { unmatched.push(input); continue }
    for (const name of hits) add(path.join(dir, name))
  }

  return { files, unmatched }
}

/** Where the PDF for `inputPath` goes. */
export function outputPathFor(inputPath: string, outDir: string | null): string {
  const base = path.basename(inputPath, path.extname(inputPath)) + '.pdf'
  return path.resolve(outDir ?? path.dirname(inputPath), base)
}
