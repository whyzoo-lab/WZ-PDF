import { describe, it, expect } from 'vitest'
import { stripDocExt } from './download'

describe('stripDocExt', () => {
  it('strips every extension the app can open', () => {
    expect(stripDocExt('report.pdf')).toBe('report')
    expect(stripDocExt('report.hwp')).toBe('report')
    expect(stripDocExt('report.hwpx')).toBe('report')
    expect(stripDocExt('mail.eml')).toBe('mail')
    expect(stripDocExt('photo.JPG')).toBe('photo')
    expect(stripDocExt('scan.bmp')).toBe('scan')
  })
  it('leaves dots inside the name alone', () => {
    expect(stripDocExt('2026.07.report.pdf')).toBe('2026.07.report')
  })
  it('leaves an unknown extension in place rather than guessing', () => {
    expect(stripDocExt('archive.tar.gz')).toBe('archive.tar.gz')
  })
})
