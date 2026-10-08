import { describe, it, expect } from 'vitest'
import { documentFileName, openableExt } from './docFileName'

const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

describe('documentFileName', () => {
  it('keeps a name that already says what the file is', () => {
    expect(documentFileName('제안서.pptx', 'pptx', ZIP)).toBe('제안서.pptx')
    expect(documentFileName('Notes.MD', 'md', new Uint8Array())).toBe('Notes.MD')
  })

  it('adds the extension a name without one is missing', () => {
    expect(documentFileName('download', 'pdf', new Uint8Array())).toBe('download.pdf')
    expect(documentFileName('view?id=17', 'hwp', OLE)).toBe('view_id=17.hwp')
    expect(documentFileName('doc', 'hwp', ZIP)).toBe('doc.hwpx')
    expect(documentFileName('scan', 'image', PNG)).toBe('scan.png')
    expect(documentFileName('table', 'sheet', OLE)).toBe('table.xls')
    expect(documentFileName(undefined, 'eml', new Uint8Array())).toBe('document.eml')
  })

  it('does not count an extension the app does not open', () => {
    expect(openableExt('report.final')).toBe('')
    expect(documentFileName('report.final', 'pdf', new Uint8Array())).toBe('report.final.pdf')
  })
})
