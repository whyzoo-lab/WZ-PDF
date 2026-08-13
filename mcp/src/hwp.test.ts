import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findAppExecutable, pdfNameFor } from './hwp.js'

/**
 * The parts that can be wrong without anything crashing: which executable gets
 * picked, and what the output is called.
 */
describe('locating the desktop app', () => {
  const original = process.env.WZPDF_APP
  afterEach(() => {
    if (original === undefined) delete process.env.WZPDF_APP
    else process.env.WZPDF_APP = original
  })

  it('finds the app two levels up, where the installer puts the server', () => {
    // Shipped layout: <install>/resources/mcp/ holds the server.
    const serverDir = resolve('C:/Program Files/WZ PDF/resources/mcp')
    const app = resolve('C:/Program Files/WZ PDF/WZ PDF.exe')
    delete process.env.WZPDF_APP

    expect(findAppExecutable(serverDir, p => resolve(p) === app)).toBe(app)
  })

  it('prefers WZPDF_APP over any guess', () => {
    process.env.WZPDF_APP = 'D:/custom/WZ PDF.exe'
    // Everything exists, so only the override's precedence is being tested.
    expect(findAppExecutable('C:/anywhere', () => true)).toBe('D:/custom/WZ PDF.exe')
  })

  it('rejects a WZPDF_APP that does not exist rather than falling back', () => {
    // Falling back would convert with a different build than the user asked for.
    process.env.WZPDF_APP = 'D:/missing/WZ PDF.exe'
    expect(() => findAppExecutable('C:/anywhere', () => false)).toThrow(/WZPDF_APP/)
  })

  it('explains what to do when the app is nowhere to be found', () => {
    delete process.env.WZPDF_APP
    expect(() => findAppExecutable('C:/anywhere', () => false))
      .toThrow(/Install WZ PDF, or set WZPDF_APP/)
  })
})

describe('output naming', () => {
  it('swaps the extension for .pdf', () => {
    expect(pdfNameFor('C:/docs/report.hwp')).toBe('report.pdf')
    expect(pdfNameFor('C:/docs/report.hwpx')).toBe('report.pdf')
  })

  it('keeps dots that are part of the name', () => {
    expect(pdfNameFor('C:/docs/v1.2.계획서.hwp')).toBe('v1.2.계획서.pdf')
  })

  it('handles Korean names', () => {
    expect(pdfNameFor('C:/docs/과업지시서.hwpx')).toBe('과업지시서.pdf')
  })
})
