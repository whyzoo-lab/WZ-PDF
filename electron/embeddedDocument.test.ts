import { describe, it, expect } from 'vitest'
import {
  EMBED_FOOTER_BYTES, EMBED_MARKER_V1, acceptEmbedded, buildTrailer, cleanEmbeddedName, locateEmbedded,
} from './embeddedDocument'

const EXE = Buffer.from('MZ' + 'x'.repeat(1000))
const PDF = Buffer.from('%PDF-1.7\nfake pdf body')
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('docx body')])

/** An exported exe as the main process writes one, then read back. */
function roundTrip(exe: Buffer) {
  const footer = exe.subarray(exe.length - EMBED_FOOTER_BYTES)
  const at = locateEmbedded(exe.length, footer)
  if (!at) return null
  const bytes = exe.subarray(at.offset, at.offset + at.size)
  const name = at.name ? exe.subarray(at.name.offset, at.name.offset + at.name.length) : null
  return acceptEmbedded(new Uint8Array(bytes), name ? new Uint8Array(name) : null)
}

function exportExe(doc: Buffer, name: string): Buffer {
  return Buffer.concat([EXE, doc, buildTrailer(name, doc.length)])
}

describe('embedded document', () => {
  it('carries any format under its own name, Korean names included', () => {
    for (const [doc, name] of [
      [PDF, 'report.pdf'],
      [ZIP, '제안서 최종.pptx'],
      [Buffer.from('# 제목\n본문'), 'notes.md'],
      [Buffer.from('From: a@b\r\n\r\nbody'), 'mail.eml'],
    ] as const) {
      const got = roundTrip(exportExe(doc, name))
      expect(got?.name).toBe(name)
      expect(Buffer.from(got!.bytes).equals(doc)).toBe(true)
    }
  })

  it('still reads a V01 exe, which carried a PDF', () => {
    const size = Buffer.alloc(4)
    size.writeUInt32LE(PDF.length)
    const got = roundTrip(Buffer.concat([EXE, PDF, size, EMBED_MARKER_V1]))
    expect(got?.name).toBe('document.pdf')
    expect(Buffer.from(got!.bytes).equals(PDF)).toBe(true)
  })

  it('finds nothing in a plain exe', () => {
    expect(roundTrip(EXE)).toBeNull()
  })

  it('refuses bytes that are not what the name says', () => {
    // A .docx must be a zip; an exe renamed .docx is not.
    expect(roundTrip(exportExe(Buffer.from('MZ not a document'), 'evil.docx'))).toBeNull()
    expect(roundTrip(exportExe(PDF, 'program.exe'))).toBeNull()
  })

  it('refuses a trailer whose size runs past the start of the file', () => {
    const exe = exportExe(PDF, 'a.pdf')
    const footer = Buffer.from(exe.subarray(exe.length - EMBED_FOOTER_BYTES))
    footer.writeUInt32LE(exe.length * 2, 2)
    expect(locateEmbedded(exe.length, footer)).toBeNull()
  })

  it('cleans names down to a file name the app opens', () => {
    expect(cleanEmbeddedName('C:\\docs\\보고서.hwp')).toBe('보고서.hwp')
    expect(cleanEmbeddedName('../../x.pdf')).toBe('x.pdf')
    expect(cleanEmbeddedName('run.exe')).toBeNull()
    expect(cleanEmbeddedName('a\u0007.pdf')).toBeNull()
    expect(cleanEmbeddedName('x'.repeat(300) + '.pdf')).toBeNull()
    expect(cleanEmbeddedName(42)).toBeNull()
  })

  it('refuses a carried name with a folder in it', () => {
    // The writer cleans names, so one with a path can only be hand-made.
    const doc = PDF
    const name = Buffer.from('dir/a.pdf')
    const tail = Buffer.alloc(6)
    tail.writeUInt16LE(name.length, 0)
    tail.writeUInt32LE(doc.length, 2)
    const exe = Buffer.concat([EXE, doc, name, tail, Buffer.from('WZPDF_VIEWER_V02')])
    expect(roundTrip(exe)).toBeNull()
  })
})
