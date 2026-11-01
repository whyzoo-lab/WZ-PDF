import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { inflateBounded, ooxmlText, tidyLines, zipText } from './ooxmlText'

/** Each of these took seconds to tens of seconds before the fix. */
const QUICKLY_MS = 500

function timed(work: () => unknown): number {
  const started = performance.now()
  work()
  return performance.now() - started
}

describe('ooxmlText on hostile input', () => {
  it('fails fast on repeated unclosed tags', () => {
    expect(timed(() => ooxmlText('<a:blip r:id="'.repeat(40_000), 'w', rid => rid))).toBeLessThan(QUICKLY_MS)
    expect(timed(() => ooxmlText('<w:p '.repeat(100_000), 'w'))).toBeLessThan(QUICKLY_MS)
  })

  it('keeps long runs of spaces cheap, in text and in table cells', () => {
    const spaces = `<w:p><w:r><w:t xml:space="preserve">${' '.repeat(200_000)}x</w:t></w:r></w:p>`
    expect(timed(() => ooxmlText(spaces, 'w'))).toBeLessThan(QUICKLY_MS)
    const cell = '<w:tc><w:p><w:r><w:t xml:space="preserve">a   </w:t></w:r></w:p></w:tc>'
    const table = `<w:tbl><w:tr>${cell.repeat(20_000)}</w:tr></w:tbl>`
    expect(timed(() => ooxmlText(table, 'w'))).toBeLessThan(QUICKLY_MS * 2)
  })

  it('still reads pictures and table cells as before', () => {
    const xml = `<w:p><w:r><w:t>앞</w:t></w:r></w:p><a:blip cstate="print" r:embed="rId7"/>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t xml:space="preserve">가  </w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>나</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    const seen: string[] = []
    const text = ooxmlText(xml, 'w', rid => { seen.push(rid); return '[그림]' })
    expect(seen).toEqual(['rId7'])
    expect(text).toContain('[그림]')
    expect(text).toContain('가\t나')
  })
})

describe('tidyLines', () => {
  it('drops trailing blanks and collapses empty lines', () => {
    expect(tidyLines('a  \t\n\n\n\nb \n')).toBe('a\n\nb')
    expect(timed(() => tidyLines(`${' '.repeat(200_000)}x`))).toBeLessThan(QUICKLY_MS)
  })
})

describe('inflateBounded', () => {
  const zipped = async (bytes: Uint8Array) => {
    const zip = new JSZip()
    zip.file('part.xml', bytes)
    const packed = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    return JSZip.loadAsync(packed)
  }

  it('returns an entry intact, across inflate chunks', async () => {
    const bytes = new Uint8Array(300_000).map((_, i) => (i * 31) & 0xff)
    const zip = await zipped(bytes)
    expect(await inflateBounded(zip.file('part.xml')!, bytes.length)).toEqual(bytes)
  })

  it('stops an entry that inflates past the limit', async () => {
    const zip = await zipped(new Uint8Array(5_000_000))
    await expect(inflateBounded(zip.file('part.xml')!, 1_000_000)).rejects.toThrow(/once unpacked/)
  })

  it('reads a text part as UTF-8', async () => {
    const zip = await zipped(new TextEncoder().encode('<w:t>한글</w:t>'))
    expect(await zipText(zip, 'part.xml')).toBe('<w:t>한글</w:t>')
    expect(await zipText(zip, 'missing.xml')).toBeNull()
  })
})
