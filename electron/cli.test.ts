import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONVERTERS,
  type ConverterSpec,
  type DirEntry,
  type FsProbe,
  converterFor,
  expandInputs,
  hasWildcard,
  isConvertible,
  matchesWildcard,
  outputPathFor,
  parseCliArgs,
  usageFor,
} from './cli.ts'

const specOf = (name: string): ConverterSpec => {
  const spec = CONVERTERS.find(c => c.name === name)
  if (!spec) throw new Error(`no such converter: ${name}`)
  return spec
}

const HWP2PDF = specOf('hwp2pdf')
const HWP2HWPX = specOf('hwp2hwpx')
const HWPX2HWP = specOf('hwpx2hwp')

/**
 * A fake tree, so no fixture files are needed. Keys are directories, values are
 * their entries; a name ending in `/` is a sub-directory.
 */
function tree(layout: Record<string, string[]>): FsProbe {
  const dirs = new Map<string, DirEntry[]>()
  for (const [dir, names] of Object.entries(layout)) {
    dirs.set(path.resolve(dir).toLowerCase(), names.map(name => ({
      name: name.replace(/\/$/, ''),
      isDirectory: name.endsWith('/'),
    })))
  }
  return {
    readDir(dir) {
      const entries = dirs.get(path.resolve(dir).toLowerCase())
      if (!entries) throw new Error(`ENOENT: ${dir}`)
      return entries
    },
    isDirectory(target) {
      return dirs.has(path.resolve(target).toLowerCase())
    },
  }
}

describe('converter selection', () => {
  it('picks the converter from the switch the launcher passed', () => {
    expect(converterFor(['C:/apps/WZ PDF.exe', '--hwp2hwpx', 'a.hwp'])?.name).toBe('hwp2hwpx')
    expect(converterFor(['C:/apps/WZ PDF.exe', '--hwpx2hwp', 'a.hwpx'])?.name).toBe('hwpx2hwp')
    expect(converterFor(['C:/apps/WZ PDF.exe', 'report.pdf'])).toBeNull()
  })

  it('gives each converter a distinct switch and target', () => {
    expect(new Set(CONVERTERS.map(c => c.flag)).size).toBe(CONVERTERS.length)
    // The C# launcher derives its switch as "--" + its own file name, so the
    // two must agree exactly or the app rejects the argument.
    for (const spec of CONVERTERS) expect(spec.flag).toBe(`--${spec.name}`)
  })

  it('never accepts its own output as input, which would loop', () => {
    for (const spec of CONVERTERS) {
      expect(spec.sourceExts).not.toContain(spec.targetExt)
    }
  })
})

describe('argument parsing', () => {
  it('collects inputs and flags in any order', () => {
    const { options, error } = parseCliArgs(
      ['--hwp2hwpx', 'a.hwp', '-f', 'docs', '--out', 'dist'], HWP2HWPX)
    expect(error).toBeNull()
    expect(options.inputs).toEqual(['a.hwp', 'docs'])
    expect(options.force).toBe(true)
    expect(options.outDir).toBe('dist')
  })

  it('defaults to recursing, skipping existing output and full reporting', () => {
    const { options } = parseCliArgs(['--hwp2hwpx', 'a.hwp'], HWP2HWPX)
    expect(options.recurse).toBe(true)
    expect(options.force).toBe(false)
    expect(options.quiet).toBe(false)
    expect(options.outDir).toBeNull()
  })

  it('honours --no-recurse', () => {
    const { options } = parseCliArgs(['--hwp2hwpx', 'docs', '--no-recurse'], HWP2HWPX)
    expect(options.recurse).toBe(false)
  })

  it('rejects arguments it cannot honour instead of guessing', () => {
    expect(parseCliArgs(['--hwp2pdf'], HWP2PDF).error).toMatch(/No input/)
    expect(parseCliArgs(['--hwp2pdf', 'a.hwp', '-o'], HWP2PDF).error).toMatch(/needs a directory/)
    // -o must not swallow the next flag as if it were a directory.
    expect(parseCliArgs(['--hwp2pdf', 'a.hwp', '-o', '-f'], HWP2PDF).error).toMatch(/needs a directory/)
    expect(parseCliArgs(['--hwp2pdf', '-z', 'a.hwp'], HWP2PDF).error).toMatch(/Unknown option/)
  })

  it('ignores everything before its own flag', () => {
    // Real argv: the executable, and in dev the app directory, come first.
    // Treating those as documents made a fully successful run report failures.
    const { options, error } = parseCliArgs(
      ['C:/apps/WZ PDF.exe', '.', '--hwpx2hwp', 'a.hwpx'], HWPX2HWP)
    expect(error).toBeNull()
    expect(options.inputs).toEqual(['a.hwpx'])
  })

  it('accepts --help with no inputs', () => {
    const { options, error } = parseCliArgs(['--hwp2hwpx', '--help'], HWP2HWPX)
    expect(error).toBeNull()
    expect(options.help).toBe(true)
  })
})

describe('usage text', () => {
  it('names the tool, its inputs and its output', () => {
    const usage = usageFor(HWPX2HWP)
    expect(usage).toContain('hwpx2hwp')
    expect(usage).toContain('.hwpx')
    expect(usage).toContain('.hwp files')
    expect(usage).toContain('--no-recurse')
  })
})

describe('accepted extensions', () => {
  it('follows the converter, not a global list', () => {
    expect(isConvertible('a.hwp', HWP2HWPX)).toBe(true)
    expect(isConvertible('a.hwpx', HWP2HWPX)).toBe(false)
    expect(isConvertible('a.hwpx', HWPX2HWP)).toBe(true)
    expect(isConvertible('a.hwp', HWPX2HWP)).toBe(false)
    // hwp2pdf takes both.
    expect(isConvertible('a.HWP', HWP2PDF)).toBe(true)
    expect(isConvertible('a.HWPX', HWP2PDF)).toBe(true)
    expect(isConvertible('a.pdf', HWP2PDF)).toBe(false)
  })
})

describe('wildcard matching', () => {
  it('handles * and ?', () => {
    expect(matchesWildcard('report.hwp', '*.hwp')).toBe(true)
    expect(matchesWildcard('report.hwpx', '*.hwp')).toBe(false)
    expect(matchesWildcard('2026-01-report.hwp', '2026-??-*.hwp')).toBe(true)
    expect(matchesWildcard('2026-1-report.hwp', '2026-??-*.hwp')).toBe(false)
    expect(matchesWildcard('anything', '*')).toBe(true)
  })

  it('is case-insensitive, like the filesystem it matches against', () => {
    expect(matchesWildcard('REPORT.HWP', '*.hwp')).toBe(true)
  })

  it('treats regex metacharacters in a name as ordinary text', () => {
    // The reason this is a direct matcher and not a translated RegExp.
    expect(matchesWildcard('report(final).hwp', '*.hwp')).toBe(true)
    expect(matchesWildcard('a+b[1].hwp', 'a+b[1].hwp')).toBe(true)
    expect(matchesWildcard('axb.hwp', 'a.b.hwp')).toBe(false)
  })

  it('detects patterns', () => {
    expect(hasWildcard('*.hwp')).toBe(true)
    expect(hasWildcard('a?.hwp')).toBe(true)
    expect(hasWildcard('plain.hwp')).toBe(false)
  })
})

describe('input expansion', () => {
  it('expands a pattern to the matching files only', () => {
    const probe = tree({ 'C:/docs': ['a.hwp', 'b.hwpx', 'c.txt', 'sub/'] })
    const { files, unmatched } = expandInputs({
      inputs: ['C:/docs/*.hwp'], spec: HWP2HWPX, probe,
    })
    expect(files.map(f => path.basename(f.path))).toEqual(['a.hwp'])
    expect(unmatched).toEqual([])
  })

  it('walks a folder and its sub-folders', () => {
    const probe = tree({
      'C:/docs': ['top.hwp', 'notes.txt', 'sub/'],
      'C:/docs/sub': ['deep.hwp', 'deeper/'],
      'C:/docs/sub/deeper': ['bottom.hwp'],
    })
    const { files } = expandInputs({ inputs: ['C:/docs'], spec: HWP2HWPX, probe })
    expect(files.map(f => path.basename(f.path)).sort())
      .toEqual(['bottom.hwp', 'deep.hwp', 'top.hwp'])
    // Every file remembers the folder the search started from, which is what
    // -o mirrors.
    for (const file of files) expect(file.base).toBe(path.resolve('C:/docs'))
  })

  it('stays in the named folder with --no-recurse', () => {
    const probe = tree({
      'C:/docs': ['top.hwp', 'sub/'],
      'C:/docs/sub': ['deep.hwp'],
    })
    const { files } = expandInputs({
      inputs: ['C:/docs'], spec: HWP2HWPX, recurse: false, probe,
    })
    expect(files.map(f => path.basename(f.path))).toEqual(['top.hwp'])
  })

  it('reports an input that yields nothing rather than silently dropping it', () => {
    const probe = tree({ 'C:/docs': ['only.txt'], 'C:/empty': [] })
    const { files, unmatched } = expandInputs({
      inputs: ['C:/docs/*.hwp', 'C:/empty', 'C:/nope/*.hwp'], spec: HWP2HWPX, probe,
    })
    expect(files).toEqual([])
    expect(unmatched).toEqual(['C:/docs/*.hwp', 'C:/empty', 'C:/nope/*.hwp'])
  })

  it('takes a literal file as given, whatever its name', () => {
    // Whether it opens is reported later with the real filesystem error.
    const probe = tree({ 'C:/docs': [] })
    const { files, unmatched } = expandInputs({
      inputs: ['C:/docs/missing.hwp'], spec: HWP2HWPX, probe,
    })
    expect(files).toHaveLength(1)
    expect(unmatched).toEqual([])
  })

  it('de-duplicates a file reached by more than one input', () => {
    const probe = tree({ 'C:/docs': ['a.hwp'] })
    const { files } = expandInputs({
      inputs: ['C:/docs', 'C:/docs/*.hwp', 'C:/docs/a.hwp'], spec: HWP2HWPX, probe,
    })
    expect(files).toHaveLength(1)
  })

  it('does not mistake a folder named like a document for one', () => {
    const probe = tree({
      'C:/docs': ['archive.hwp/'],
      'C:/docs/archive.hwp': ['real.hwp'],
    })
    const { files } = expandInputs({ inputs: ['C:/docs'], spec: HWP2HWPX, probe })
    expect(files.map(f => path.basename(f.path))).toEqual(['real.hwp'])
  })
})

describe('output paths', () => {
  const file = (p: string, base: string) => ({ path: path.resolve(p), base: path.resolve(base) })

  it('writes beside the input by default', () => {
    expect(outputPathFor(file('C:/docs/a.hwp', 'C:/docs'), null, HWP2HWPX))
      .toBe(path.resolve('C:/docs/a.hwpx'))
    expect(outputPathFor(file('C:/docs/a.hwpx', 'C:/docs'), null, HWPX2HWP))
      .toBe(path.resolve('C:/docs/a.hwp'))
  })

  it('keeps the source folder structure under -o', () => {
    expect(outputPathFor(file('C:/docs/sub/a.hwp', 'C:/docs'), 'D:/out', HWP2HWPX))
      .toBe(path.resolve('D:/out/sub/a.hwpx'))
  })

  it('keeps same-named files in different folders apart', () => {
    // Flattening two source trees into one output directory would silently
    // overwrite, leaving the user with fewer documents than they started with.
    const first = outputPathFor(file('C:/a/report.hwp', 'C:/a'), 'D:/out', HWP2HWPX)
    const second = outputPathFor(file('C:/a/q1/report.hwp', 'C:/a'), 'D:/out', HWP2HWPX)
    expect(first).not.toBe(second)
  })

  it('keeps a name that contains dots', () => {
    expect(outputPathFor(file('C:/docs/2026.01.report.hwp', 'C:/docs'), null, HWP2HWPX))
      .toBe(path.resolve('C:/docs/2026.01.report.hwpx'))
  })
})
