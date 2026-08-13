import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  expandInputs,
  hasWildcard,
  isConvertible,
  matchesWildcard,
  outputPathFor,
  parseCliArgs,
} from './cli.ts'

/** Stand-in for a folder, so no fixture files are needed. */
const folder = (...names: string[]) => () => names

describe('hwp2pdf argument parsing', () => {
  it('collects inputs and flags in any order', () => {
    const { options, error } = parseCliArgs(['--hwp2pdf', 'a.hwp', '-f', 'b.hwpx', '--out', 'dist'])
    expect(error).toBeNull()
    expect(options.inputs).toEqual(['a.hwp', 'b.hwpx'])
    expect(options.force).toBe(true)
    expect(options.outDir).toBe('dist')
  })

  it('defaults to skipping existing PDFs and to full output', () => {
    const { options } = parseCliArgs(['--hwp2pdf', 'a.hwp'])
    expect(options.force).toBe(false)
    expect(options.quiet).toBe(false)
    expect(options.outDir).toBeNull()
  })

  it('rejects arguments it cannot honour instead of guessing', () => {
    expect(parseCliArgs(['--hwp2pdf']).error).toMatch(/No input/)
    expect(parseCliArgs(['--hwp2pdf', 'a.hwp', '-o']).error).toMatch(/needs a directory/)
    // -o must not swallow the next flag as if it were a directory.
    expect(parseCliArgs(['--hwp2pdf', 'a.hwp', '-o', '-f']).error).toMatch(/needs a directory/)
    expect(parseCliArgs(['--hwp2pdf', '-z', 'a.hwp']).error).toMatch(/Unknown option/)
  })

  it('ignores everything before the flag', () => {
    // Real argv: the executable, and in dev the app directory, come first.
    // Treating those as documents made a fully successful run report failures.
    const { options, error } = parseCliArgs([
      'C:/apps/WZ PDF.exe', '.', '--hwp2pdf', 'a.hwp',
    ])
    expect(error).toBeNull()
    expect(options.inputs).toEqual(['a.hwp'])
  })

  it('accepts --help with no inputs', () => {
    const { options, error } = parseCliArgs(['--hwp2pdf', '--help'])
    expect(error).toBeNull()
    expect(options.help).toBe(true)
  })
})

describe('wildcard matching', () => {
  it('handles * and ?', () => {
    expect(matchesWildcard('report.hwp', '*.hwp')).toBe(true)
    expect(matchesWildcard('report.hwpx', '*.hwp')).toBe(false)
    expect(matchesWildcard('2026-01-report.hwp', '2026-??-*.hwp')).toBe(true)
    expect(matchesWildcard('2026-1-report.hwp', '2026-??-*.hwp')).toBe(false)
    expect(matchesWildcard('a.hwp', '?.hwp')).toBe(true)
    expect(matchesWildcard('ab.hwp', '?.hwp')).toBe(false)
  })

  it('is case-insensitive, as Windows is', () => {
    expect(matchesWildcard('REPORT.HWP', '*.hwp')).toBe(true)
    expect(matchesWildcard('report.hwp', '*.HWP')).toBe(true)
  })

  it('matches Korean file names', () => {
    expect(matchesWildcard('과업지시서.hwp', '*지시서.hwp')).toBe(true)
    expect(matchesWildcard('과업계획서.hwp', '*지시서.hwp')).toBe(false)
  })

  it('treats regex punctuation in a name as literal text', () => {
    // The whole reason this is a matcher and not a generated RegExp.
    expect(matchesWildcard('report(final).hwp', '*.hwp')).toBe(true)
    expect(matchesWildcard('report(final).hwp', 'report(final).hwp')).toBe(true)
    expect(matchesWildcard('reportXfinalX.hwp', 'report(final).hwp')).toBe(false)
    expect(matchesWildcard('a+b.hwp', 'a+b.hwp')).toBe(true)
    expect(matchesWildcard('aab.hwp', 'a+b.hwp')).toBe(false)
  })

  it('does not blow up on many stars', () => {
    // A translated regex could backtrack exponentially here.
    const start = Date.now()
    expect(matchesWildcard('a'.repeat(60) + '.hwpx', '*a*a*a*a*a*a*a*a*a*a*.hwp')).toBe(false)
    expect(Date.now() - start).toBeLessThan(500)
  })

  it('knows which names carry a pattern', () => {
    expect(hasWildcard('*.hwp')).toBe(true)
    expect(hasWildcard('a?.hwp')).toBe(true)
    expect(hasWildcard('plain.hwp')).toBe(false)
  })
})

describe('input expansion', () => {
  it('expands a pattern to the convertible files only, sorted', () => {
    const { files, unmatched } = expandInputs(
      ['*.hwp*'],
      folder('b.hwp', 'a.hwpx', 'notes.txt', 'scan.pdf'),
    )
    expect(files.map(f => path.basename(f))).toEqual(['a.hwpx', 'b.hwp'])
    expect(unmatched).toEqual([])
  })

  it('reports a pattern that matched nothing', () => {
    const { files, unmatched } = expandInputs(['*.hwp'], folder('notes.txt'))
    expect(files).toEqual([])
    expect(unmatched).toEqual(['*.hwp'])
  })

  it('reports a directory it cannot read', () => {
    const { unmatched } = expandInputs(['nope/*.hwp'], () => { throw new Error('ENOENT') })
    expect(unmatched).toEqual(['nope/*.hwp'])
  })

  it('passes literal paths through without touching the disk', () => {
    const { files } = expandInputs(['some/a.hwp'], () => { throw new Error('should not read') })
    expect(files).toHaveLength(1)
    expect(path.basename(files[0])).toBe('a.hwp')
  })

  it('does not convert the same file twice', () => {
    // Overlapping patterns are the normal way this happens: `*.hwp a.hwp`.
    const { files } = expandInputs(['*.hwp', 'a.hwp'], folder('a.hwp'))
    expect(files).toHaveLength(1)
  })
})

describe('output paths', () => {
  it('puts the PDF beside the input by default', () => {
    expect(outputPathFor(path.resolve('docs/report.hwp'), null))
      .toBe(path.resolve('docs/report.pdf'))
  })

  it('honours an output directory', () => {
    expect(outputPathFor(path.resolve('docs/report.hwpx'), path.resolve('out')))
      .toBe(path.resolve('out/report.pdf'))
  })

  it('replaces only the extension, keeping dots in the name', () => {
    expect(path.basename(outputPathFor('v1.2.report.hwp', null))).toBe('v1.2.report.pdf')
  })

  it('accepts only hwp and hwpx', () => {
    expect(isConvertible('a.hwp')).toBe(true)
    expect(isConvertible('a.HWPX')).toBe(true)
    expect(isConvertible('a.pdf')).toBe(false)
    expect(isConvertible('a')).toBe(false)
  })
})
