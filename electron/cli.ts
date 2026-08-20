import fs from 'node:fs'
import path from 'node:path'

/**
 * Argument handling shared by the `hwp2pdf`, `hwp2hwpx` and `hwpx2hwp` console
 * tools.
 *
 * Kept free of Electron and of any I/O beyond directory listing, so the parts
 * that are easy to get wrong — wildcard matching, recursion, output paths, the
 * skip/overwrite rule — are unit-testable without launching the app.
 *
 * Windows does not expand wildcards for a program the way a Unix shell does:
 * `hwp2hwpx *.hwp` arrives literally as the string `*.hwp`. Expanding it is
 * therefore the tool's job, not a nicety.
 *
 * The three tools differ only in what they accept, what they produce and how
 * the conversion itself runs, so everything else lives here once. See
 * convertRunner.ts for the driver and the two backends beside it.
 */

export interface ConverterSpec {
  /** argv flag the app is launched with by the console launcher. */
  flag: string
  /** Tool name as typed in a terminal, and the launcher's file name. */
  name: string
  /** Accepted input extensions, lower-case and without the dot. */
  sourceExts: readonly string[]
  /** Produced extension, without the dot. */
  targetExt: string
  /** One-line description for the usage text. */
  summary: string
}

/**
 * Every converter the app can be driven as.
 *
 * The `flag` values are also the allowlist the C# launcher checks its own file
 * name against (cli/wzconvert.cs), so a renamed copy of the launcher cannot
 * hand the app some other switch.
 */
export const CONVERTERS: readonly ConverterSpec[] = [
  {
    flag: '--hwp2pdf',
    name: 'hwp2pdf',
    sourceExts: ['hwp', 'hwpx'],
    targetExt: 'pdf',
    summary: 'convert HWP/HWPX documents to PDF',
  },
  {
    flag: '--hwp2hwpx',
    name: 'hwp2hwpx',
    sourceExts: ['hwp'],
    targetExt: 'hwpx',
    summary: 'convert HWP documents to HWPX',
  },
  {
    flag: '--hwpx2hwp',
    name: 'hwpx2hwp',
    sourceExts: ['hwpx'],
    targetExt: 'hwp',
    summary: 'convert HWPX documents to HWP',
  },
]

/** Which converter, if any, this process was launched as. */
export function converterFor(argv: readonly string[]): ConverterSpec | null {
  return CONVERTERS.find(spec => argv.includes(spec.flag)) ?? null
}

export interface CliOptions {
  /** Literal paths, folders and wildcard patterns, in the order given. */
  inputs: string[]
  /** Write output here instead of beside each input, mirroring the source tree. */
  outDir: string | null
  /** Overwrite an existing output file instead of skipping it. */
  force: boolean
  /** Descend into sub-folders of a folder that was named as an input. */
  recurse: boolean
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

export function usageFor(spec: ConverterSpec): string {
  const accepts = spec.sourceExts.map(ext => '.' + ext).join(' / ')
  const out = '.' + spec.targetExt
  return [
    `${spec.name} — ${spec.summary}`,
    '',
    `  ${spec.name} [options] <file|folder|pattern>...`,
    '',
    '  A folder is searched recursively. Wildcards * and ? are expanded by the',
    '  tool itself, because Windows hands them to a program unexpanded:',
    `    ${spec.name} *.${spec.sourceExts[0]}`,
    `    ${spec.name} C:\\docs\\2026`,
    `    ${spec.name} C:\\a C:\\b -o C:\\converted`,
    '',
    'Options:',
    `  -o, --out <dir>   write ${out} files under <dir>, keeping each input's`,
    '                    folder structure (default: beside each input)',
    `  -f, --force       overwrite an existing ${out} file (default: skip it)`,
    '      --no-recurse  do not descend into sub-folders',
    '  -q, --quiet       only report failures',
    '  -h, --help        show this help',
    '',
    `Accepts ${accepts} files.`,
    'Exit codes: 0 all converted, 1 one or more failed, 2 bad arguments.',
  ].join('\n')
}

export function parseCliArgs(argv: readonly string[], spec: ConverterSpec): CliParseResult {
  const options: CliOptions = {
    inputs: [], outDir: null, force: false, recurse: true, quiet: false, help: false,
  }

  // Only what follows the flag is ours. Everything before it belongs to the
  // process launch — argv[0] is the executable, and in development argv[1] is
  // the app directory — and treating those as documents made every run report
  // failures (and a non-zero exit) even when every file converted.
  const flagAt = argv.indexOf(spec.flag)
  const args = flagAt === -1 ? argv : argv.slice(flagAt + 1)

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-h' || arg === '--help') { options.help = true; continue }
    if (arg === '-f' || arg === '--force') { options.force = true; continue }
    if (arg === '-q' || arg === '--quiet') { options.quiet = true; continue }
    if (arg === '--no-recurse') { options.recurse = false; continue }
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

export function isConvertible(filePath: string, spec: ConverterSpec): boolean {
  const ext = path.extname(filePath).toLowerCase().slice(1)
  return spec.sourceExts.includes(ext)
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

export interface DirEntry {
  name: string
  isDirectory: boolean
}

/** The filesystem, injected so expansion can be tested without fixture files. */
export interface FsProbe {
  readDir(dir: string): DirEntry[]
  isDirectory(target: string): boolean
}

export const nodeProbe: FsProbe = {
  readDir(dir) {
    // A symbolic link reports isDirectory() === false here, so a link pointing
    // back up its own tree cannot send the walk into an infinite loop.
    return fs.readdirSync(dir, { withFileTypes: true })
      .map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() }))
  },
  isDirectory(target) {
    try { return fs.statSync(target).isDirectory() } catch { return false }
  },
}

export interface ExpandedFile {
  /** Absolute path of the document. */
  path: string
  /**
   * The directory the search that found it started from.
   *
   * This is what `-o` mirrors: without it, converting two folders into one
   * output directory would silently overwrite same-named files from different
   * sub-folders, and the user would just end up with fewer documents than they
   * started with.
   */
  base: string
}

export interface ExpandResult {
  files: ExpandedFile[]
  /** Inputs that matched nothing, for a useful error message. */
  unmatched: string[]
}

export interface ExpandArgs {
  inputs: readonly string[]
  spec: ConverterSpec
  recurse?: boolean
  probe?: FsProbe
}

/**
 * Turn the given paths, folders and patterns into a de-duplicated file list.
 *
 * Wildcards are honoured in the last path segment only; a folder is walked
 * instead. An input that yields nothing is reported rather than silently
 * dropped — printing nothing is the worst possible answer to `hwp2hwpx *.hwp`
 * run in the wrong folder.
 */
export function expandInputs({ inputs, spec, recurse = true, probe = nodeProbe }: ExpandArgs): ExpandResult {
  const files: ExpandedFile[] = []
  const unmatched: string[] = []
  const seen = new Set<string>()

  const add = (filePath: string, base: string): boolean => {
    const resolved = path.resolve(filePath)
    const key = resolved.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    files.push({ path: resolved, base: path.resolve(base) })
    return true
  }

  const walk = (dir: string, base: string): number => {
    let found = 0
    let entries: DirEntry[]
    try { entries = probe.readDir(dir) } catch { return 0 }
    // Sorted so a batch converts in a predictable order and its log is
    // comparable between runs.
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory) {
        if (recurse) found += walk(full, base)
        continue
      }
      if (!isConvertible(entry.name, spec)) continue
      if (add(full, base)) found++
    }
    return found
  }

  for (const input of inputs) {
    if (hasWildcard(input)) {
      const dir = path.dirname(input) || '.'
      const pattern = path.basename(input)
      let entries: DirEntry[]
      try { entries = probe.readDir(dir) } catch { unmatched.push(input); continue }
      const hits = entries
        .filter(entry => !entry.isDirectory
          && isConvertible(entry.name, spec)
          && matchesWildcard(entry.name, pattern))
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b))
      if (hits.length === 0) { unmatched.push(input); continue }
      for (const name of hits) add(path.join(dir, name), dir)
      continue
    }

    if (probe.isDirectory(input)) {
      if (walk(input, input) === 0) unmatched.push(input)
      continue
    }

    // A literal file path is taken as given; whether it opens is reported
    // later, with the real filesystem error rather than a guess.
    add(input, path.dirname(input))
  }

  return { files, unmatched }
}

/** Where the converted file for `file` goes. */
export function outputPathFor(
  file: ExpandedFile,
  outDir: string | null,
  spec: ConverterSpec,
): string {
  const name = path.basename(file.path, path.extname(file.path)) + '.' + spec.targetExt
  if (outDir === null) return path.resolve(path.dirname(file.path), name)
  // Every file was found by walking down from its own base, so this relative
  // path can never climb out of the output directory with a leading `..`.
  const rel = path.relative(file.base, path.dirname(file.path))
  return path.resolve(outDir, rel, name)
}
