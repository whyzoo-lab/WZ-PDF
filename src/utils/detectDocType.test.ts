import { describe, it, expect } from 'vitest'
import { detectDocType, classifyDocFile } from './detectDocType'

const buf = (...b: number[]) => new Uint8Array(b).buffer

describe('detectDocType', () => {
  it('detects PDF by %PDF magic', () => {
    expect(detectDocType('a.pdf', buf(0x25,0x50,0x44,0x46,0x2d))).toBe('pdf')
  })
  it('detects HWP binary by OLE2 magic', () => {
    expect(detectDocType('a.hwp', buf(0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1))).toBe('hwp')
  })
  it('detects HWPX by zip magic + .hwpx extension', () => {
    expect(detectDocType('a.hwpx', buf(0x50,0x4B,0x03,0x04))).toBe('hwp')
  })
  it('does not treat a plain .zip as hwp — it may be a ZIP of pictures', () => {
    expect(detectDocType('a.zip', buf(0x50,0x4B,0x03,0x04))).toBe('image')
  })
  it('falls back to extension when bytes are short', () => {
    expect(detectDocType('a.hwp', buf(0x00))).toBe('hwp')
  })
  it('returns unknown for unrelated content', () => {
    expect(detectDocType('a.txt', buf(0x68,0x69))).toBe('unknown')
  })
  it('magic bytes beat a wrong extension (OLE2 named .pdf → hwp)', () => {
    expect(detectDocType('weird.pdf', buf(0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1))).toBe('hwp')
  })
})

describe('detectDocType — images', () => {
  it('detects PNG by magic even when the name lies', () => {
    expect(detectDocType('actually.txt', buf(0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A))).toBe('image')
  })
  it('detects JPEG by magic', () => {
    expect(detectDocType('a.jpg', buf(0xFF,0xD8,0xFF,0xE0))).toBe('image')
  })
  it('detects GIF by magic', () => {
    expect(detectDocType('a.gif', buf(0x47,0x49,0x46,0x38,0x39,0x61))).toBe('image')
  })
  it('detects BMP by magic', () => {
    expect(detectDocType('a.bmp', buf(0x42,0x4D,0x46,0x00))).toBe('image')
  })
  it('detects WEBP only when the RIFF payload says WEBP', () => {
    const riff = [0x52,0x49,0x46,0x46, 0,0,0,0]
    expect(detectDocType('a.webp', buf(...riff, 0x57,0x45,0x42,0x50))).toBe('image')
    // Same RIFF container, different payload (e.g. .wav) must not be an image.
    expect(detectDocType('a.wav', buf(...riff, 0x57,0x41,0x56,0x45))).toBe('unknown')
  })
  it('falls back to the extension when bytes are inconclusive', () => {
    expect(detectDocType('a.png', buf(0x00))).toBe('image')
    expect(detectDocType('a.webp', buf(0x00))).toBe('image')
  })
  it('keeps PDF/HWP winning over an image extension', () => {
    expect(detectDocType('trick.png', buf(0x25,0x50,0x44,0x46))).toBe('pdf')
  })
})

describe('classifyDocFile', () => {
  const f = (name: string, type = '') => new File([new Uint8Array([0])], name, { type })
  it('accepts images for upload/drop', () => {
    expect(classifyDocFile(f('a.png')).isImage).toBe(true)
    expect(classifyDocFile(f('a.bmp')).supported).toBe(true)
    expect(classifyDocFile(f('shot', 'image/jpeg')).isImage).toBe(true)
  })
  it('still rejects unrelated files', () => {
    expect(classifyDocFile(f('a.exe')).supported).toBe(false)
  })
})

describe('detectDocType — content wins over a misleading name', () => {
  // The Viewer EXE hands its payload to the renderer as "document.pdf" whatever
  // was embedded, so these are the cases that used to open as a broken PDF.
  const enc = (s: string) => new TextEncoder().encode(s).buffer

  it('spots an HWPX by its OCF mimetype entry, not the extension', () => {
    // PK header, then the uncompressed `mimetype` entry HWPX always starts with.
    const zip = 'PK\x03\x04' + '\x00'.repeat(26) + 'mimetypeapplication/hwp+zip'
    expect(detectDocType('document.pdf', enc(zip))).toBe('hwp')
  })

  it('reads a .zip as pictures, and a ZIP named otherwise by its name', () => {
    expect(detectDocType('document.pdf', enc('PK\x03\x04' + '\x00'.repeat(40)))).toBe('pdf')
    expect(detectDocType('a.zip', enc('PK\x03\x04' + '\x00'.repeat(40)))).toBe('image')
  })

  it('recognizes TIFF by its signature, either byte order', () => {
    expect(detectDocType('scan', buf(0x49, 0x49, 0x2A, 0x00, 8, 0, 0, 0))).toBe('image')
    expect(detectDocType('scan.pdf', buf(0x4D, 0x4D, 0x00, 0x2A, 0, 0, 0, 8))).toBe('image')
  })

  it('spots a message by its headers even when named .pdf', () => {
    expect(detectDocType('document.pdf', enc('From: a@b.com\r\nSubject: hi\r\n\r\nbody'))).toBe('eml')
  })

  it('does not mistake an actual PDF for a message', () => {
    expect(detectDocType('document.pdf', enc('%PDF-1.7\nFrom: x'))).toBe('pdf')
  })
})

describe('detectDocType — Office', () => {
  const zipWith = (...names: string[]) => {
    // A zip's central directory names every part; a tail holding those names is
    // all the sniffer reads.
    const text = names.join('\0')
    const bytes = new Uint8Array(4 + text.length)
    bytes.set([0x50, 0x4B, 0x03, 0x04])
    for (let i = 0; i < text.length; i++) bytes[4 + i] = text.charCodeAt(i)
    return bytes.buffer
  }
  it('tells Word from Excel by the parts inside, whatever the name says', () => {
    expect(detectDocType('a.zip', zipWith('[Content_Types].xml', 'word/document.xml'))).toBe('docx')
    expect(detectDocType('report.docx', zipWith('[Content_Types].xml', 'xl/workbook.xml'))).toBe('sheet')
    expect(detectDocType('deck.zip', zipWith('[Content_Types].xml', 'ppt/presentation.xml'))).toBe('pptx')
  })
  it('still sends a HWPX zip to the HWP engine', () => {
    expect(detectDocType('a.docx', zipWith('mimetypeapplication/hwp+zip'))).toBe('hwp')
  })
  it('routes OLE2 named .xls to the spreadsheet reader and everything else to HWP', () => {
    const ole2 = buf(0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1)
    expect(detectDocType('old.xls', ole2)).toBe('sheet')
    expect(detectDocType('a.hwp', ole2)).toBe('hwp')
  })
  it('opens CSV by its extension', () => {
    expect(detectDocType('a.csv', buf(0x61, 0x2C, 0x62))).toBe('sheet')
  })
  it('accepts Office files at the open dialog', () => {
    for (const name of ['a.docx', 'a.pptx', 'a.xlsx', 'a.xls', 'a.ods', 'a.csv']) {
      expect(classifyDocFile(new File([], name)).supported, name).toBe(true)
    }
    expect(classifyDocFile(new File([], 'a.doc')).supported).toBe(false)
    expect(classifyDocFile(new File([], 'a.ppt')).supported).toBe(false)
  })
})
