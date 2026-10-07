// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { writeXlsx } from 'hucre/xlsx'
import { callTool } from './tools.js'
import { detectFormat, ooxmlText } from './docText.js'

/**
 * doc_get_text / doc_info over every format they read without the app. Each
 * fixture is built here, the smallest file of its kind that the real readers
 * accept, so the tests need nothing on disk.
 */

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`
const RELS = (...items: string[]) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`

async function docx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('word/document.xml', `<w:document xmlns:w="w"><w:body>
    <w:p><w:r><w:t>계약서</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">제1조 &amp; 목적</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>구분</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>금액</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>착수금</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>15,000,000</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`)
  zip.file('docProps/app.xml', '<Properties><Pages>3</Pages></Properties>')
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function pptx(): Promise<Buffer> {
  const zip = new JSZip()
  // Presentation order deliberately differs from the part names.
  zip.file('ppt/presentation.xml', `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>
    <p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', RELS(REL('rId2', 'slide', 'slides/slide1.xml'), REL('rId3', 'slide', 'slides/slide2.xml')))
  zip.file('ppt/slides/slide2.xml', `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t>표지</a:t></a:r></a:p><a:p><a:r><a:t>산업단지 DBMS</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`)
  zip.file('ppt/slides/_rels/slide2.xml.rels', RELS(REL('rId1', 'notesSlide', '../notesSlides/notesSlide1.xml')))
  zip.file('ppt/notesSlides/notesSlide1.xml', `<p:notes xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>발표 시 강조할 점</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld></p:notes>`)
  zip.file('ppt/slides/slide1.xml', `<p:sld xmlns:p="p" xmlns:a="a" show="0"><p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t>숨긴 부록</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

const EML = [
  'From: =?UTF-8?B?7ZmN6ri464+Z?= <hong@example.com>',
  'To: kim@example.com',
  'Subject: =?UTF-8?B?7KCc7JWI7IScIOuwnO2RnA==?=',
  'Date: Tue, 06 Oct 2026 10:00:00 +0900',
  'MIME-Version: 1.0',
  'Content-Type: text/html; charset=UTF-8',
  'Content-Transfer-Encoding: 8bit',
  '',
  '<html><style>p{color:red}</style><body><p>10월 15일 <b>오후 2시</b></p><p>본사 3층</p></body></html>',
].join('\r\n')

let dir = ''
const at = (name: string) => join(dir, name)

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wz-mcp-docs-'))
  writeFileSync(at('계약서.docx'), await docx())
  writeFileSync(at('발표.pptx'), await pptx())
  writeFileSync(at('매출.xlsx'), await writeXlsx({ sheets: [
    { name: '1분기', rows: [['지점', '매출'], ['서울', 1500], ['부산', 900], ['대구', 700]] },
    { name: '숨김', rows: [['x']], hidden: true } as never,
  ] }))
  // "이름,코드\n홍길동,007" in CP949, as Korean Excel saves a CSV.
  writeFileSync(at('명단.csv'), Buffer.from([0xc0, 0xcc, 0xb8, 0xa7, 0x2c, 0xc4, 0xda, 0xb5, 0xe5, 0x0a,
    0xc8, 0xab, 0xb1, 0xe6, 0xb5, 0xbf, 0x2c, 0x30, 0x30, 0x37]))
  writeFileSync(at('메모.md'), '# 회의 메모\n\n- 일정 확정\n')
  writeFileSync(at('안내.eml'), EML)
  writeFileSync(at('notes.txt'), 'plain')
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('doc_get_text', () => {
  it('reads Word text with table cells tab-separated', async () => {
    const text = await callTool('doc_get_text', { file: at('계약서.docx') })
    expect(text).toContain('계약서\t제1조 & 목적')
    expect(text).toContain('구분\t금액\n착수금\t15,000,000')
  })

  it('reads slides in presentation order, marks hidden ones, and includes speaker notes', async () => {
    const text = await callTool('doc_get_text', { file: at('발표.pptx') })
    expect(text.indexOf('표지')).toBeLessThan(text.indexOf('숨긴 부록'))
    expect(text).toContain('── Slide 2 (hidden) ──')
    expect(text).toContain('[Notes]\n발표 시 강조할 점')
    const withoutNotes = await callTool('doc_get_text', { file: at('발표.pptx'), notes: false, pages: [1] })
    expect(withoutNotes).not.toContain('발표 시 강조할 점')
    expect(withoutNotes).not.toContain('숨긴 부록')
  })

  it('reads visible sheets as tab-separated rows, and pages through them', async () => {
    const all = await callTool('doc_get_text', { file: at('매출.xlsx') })
    expect(all).toContain('── Sheet "1분기", rows 1-4 of 4 ──\n지점\t매출\n서울\t1500')
    expect(all).not.toContain('숨김')
    const page = await callTool('doc_get_text', { file: at('매출.xlsx'), startRow: 2, maxRows: 2 })
    expect(page).toContain('rows 2-3 of 4+')
    expect(page).toContain('call again with startRow 4')
  })

  it('reads a CP949 CSV and keeps values as written', async () => {
    expect(await callTool('doc_get_text', { file: at('명단.csv') })).toContain('이름\t코드\n홍길동\t007')
  })

  it('reads mail headers and the visible text of an HTML body', async () => {
    const text = await callTool('doc_get_text', { file: at('안내.eml') })
    expect(text).toContain('Subject: 제안서 발표')
    expect(text).toContain('From: 홍길동 <hong@example.com>')
    expect(text).toContain('10월 15일 오후 2시\n본사 3층')
    expect(text).not.toContain('color:red')
  })

  it('returns Markdown as written, and refuses formats it does not open', async () => {
    expect(await callTool('doc_get_text', { file: at('메모.md') })).toContain('# 회의 메모')
    await expect(callTool('doc_get_text', { file: at('notes.txt') })).rejects.toThrow(/not a document/)
  })
})

describe('doc_info', () => {
  it('describes each format', async () => {
    expect(await callTool('doc_info', { file: at('계약서.docx') })).toContain('Pages: 3')
    const deck = await callTool('doc_info', { file: at('발표.pptx') })
    expect(deck).toContain('Slides: 2')
    expect(deck).toContain('Hidden slides: 2')
    expect(await callTool('doc_info', { file: at('매출.xlsx') })).toContain('"1분기" — 4 rows')
    expect(await callTool('doc_info', { file: at('안내.eml') })).toContain('Subject: 제안서 발표')
  })
})

describe('doc_to_pdf', () => {
  it('writes .pdf only, and never over an existing file unless asked', async () => {
    writeFileSync(at('exists.pdf'), 'x')
    await expect(callTool('doc_to_pdf', { file: at('메모.md'), output: at('out.docx') })).rejects.toThrow(/\.pdf/)
    await expect(callTool('doc_to_pdf', { file: at('메모.md'), output: at('exists.pdf') })).rejects.toThrow(/overwrite/)
  })
})

describe('helpers', () => {
  it('trusts signatures over names', () => {
    expect(detectFormat('a.docx', new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe('pdf')
    expect(detectFormat('old.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe('sheet')
    expect(detectFormat('a.hwp', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe('hwp')
  })

  it('does not mistake w:tblPr or w:tcPr for a table or a cell', () => {
    expect(ooxmlText('<w:p><w:pPr/><w:r><w:t>a</w:t></w:r></w:p><w:tblPr/>', 'w')).toBe('a')
  })
})
