// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { callTool } from './tools.js'
import { docxText, emlPictures, pictureExtension, pptxText, sheetPictures } from './docText.js'
import { PictureMarks, pictureBlock } from './ocr.js'

/**
 * Where pictures stand in Word, PowerPoint, sheets and mail, and what
 * doc_get_text does with them before any OCR runs. Recognition itself needs
 * the desktop app; here WZPDF_APP points nowhere, so these also hold that a
 * missing app costs the OCR and never the document's own text.
 */

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`
const RELS = (...items: string[]) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

/** Text, a picture (drawn twice: Word's AlternateContent choice and fallback), more text. */
async function docx(withText = true): Promise<Buffer> {
  const zip = new JSZip()
  const t = (s: string) => (withText ? `<w:p><w:r><w:t>${s}</w:t></w:r></w:p>` : '')
  zip.file('word/document.xml', `<w:document xmlns:w="w" xmlns:a="a" xmlns:r="r" xmlns:v="v"><w:body>
    ${t('앞 문단')}
    <w:p><w:r><mc:AlternateContent><mc:Choice><w:drawing><a:graphic><a:blip r:embed="rId7"/></a:graphic></w:drawing></mc:Choice>
      <mc:Fallback><w:pict><v:imagedata r:id="rId7" o:title=""/></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>
    ${t('뒤 문단')}
  </w:body></w:document>`)
  zip.file('word/_rels/document.xml.rels', RELS(REL('rId7', 'image', 'media/image1.png')))
  zip.file('word/media/image1.png', PNG)
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function pptx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('ppt/presentation.xml', `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', RELS(REL('rId2', 'slide', 'slides/slide1.xml'), REL('rId3', 'slide', 'slides/slide2.xml')))
  zip.file('ppt/slides/slide1.xml', `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>매출 추이</a:t></a:r></a:p></p:txBody></p:sp>
    <p:pic><p:blipFill><a:blip r:embed="rId4"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`)
  zip.file('ppt/slides/_rels/slide1.xml.rels', RELS(REL('rId4', 'image', '../media/image3.png')))
  // A slide that is one screenshot and nothing else.
  zip.file('ppt/slides/slide2.xml', `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>
    <p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`)
  zip.file('ppt/slides/_rels/slide2.xml.rels', RELS(REL('rId1', 'image', '../media/image9.png')))
  zip.file('ppt/media/image3.png', PNG)
  zip.file('ppt/media/image9.png', PNG)
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function xlsx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('xl/workbook.xml', `<workbook xmlns:r="r"><sheets>
    <sheet name="견적 &amp; 도장" sheetId="1" r:id="rId1"/><sheet name="빈 시트" sheetId="2" r:id="rId2"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', RELS(REL('rId1', 'worksheet', 'worksheets/sheet1.xml'), REL('rId2', 'worksheet', 'worksheets/sheet2.xml')))
  zip.file('xl/worksheets/sheet1.xml', '<worksheet/>')
  zip.file('xl/worksheets/sheet2.xml', '<worksheet/>')
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', RELS(REL('rId1', 'drawing', '../drawings/drawing1.xml')))
  zip.file('xl/drawings/drawing1.xml', `<xdr:wsDr xmlns:a="a" xmlns:r="r">
    <xdr:pic><xdr:blipFill><a:blip r:embed="rId2"/></xdr:blipFill></xdr:pic>
    <xdr:pic><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></xdr:wsDr>`)
  zip.file('xl/drawings/_rels/drawing1.xml.rels', RELS(REL('rId1', 'image', '../media/seal.png'), REL('rId2', 'image', '../media/logo.png')))
  return zip.generateAsync({ type: 'nodebuffer' })
}

const b64 = Buffer.from(PNG).toString('base64')
const EML = [
  'From: a@example.com', 'To: b@example.com', 'Subject: poster', 'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="X"', '',
  '--X', 'Content-Type: text/html; charset=UTF-8', '',
  `<p>본문</p><img src="cid:p1">`,
  '--X', 'Content-Type: image/png', 'Content-ID: <p1>', 'Content-Disposition: inline', 'Content-Transfer-Encoding: base64', '', b64,
  '--X', 'Content-Type: image/png; name="scan.png"', 'Content-Disposition: attachment; filename="scan.png"', 'Content-Transfer-Encoding: base64', '', b64,
  '--X', 'Content-Type: application/pdf; name="a.pdf"', 'Content-Disposition: attachment; filename="a.pdf"', 'Content-Transfer-Encoding: base64', '',
  Buffer.from('%PDF-1.4').toString('base64'),
  '--X--', '',
].join('\r\n')

let dir = ''
const at = (name: string) => join(dir, name)
const savedApp = process.env.WZPDF_APP

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wz-mcp-ocr-'))
  writeFileSync(at('그림.docx'), await docx())
  writeFileSync(at('스캔.docx'), await docx(false))
  writeFileSync(at('덱.pptx'), await pptx())
  writeFileSync(at('사진.png'), PNG)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))
afterEach(() => {
  if (savedApp === undefined) delete process.env.WZPDF_APP
  else process.env.WZPDF_APP = savedApp
})
const noApp = () => { process.env.WZPDF_APP = join(dir, 'missing', 'WZ PDF.exe') }

describe('pictures in documents', () => {
  it('marks a Word picture where it stands, once, by its part', async () => {
    const marks = new PictureMarks()
    const { text } = await docxText(new Uint8Array(await docx()), marks.mark)
    expect(marks.partsIn(text)).toEqual(['word/media/image1.png'])
    const filled = marks.fill(text, new Map([['word/media/image1.png', ['매출 1,500', '2026년']]]))
    expect(filled).toBe(`앞 문단\n\n${pictureBlock(['매출 1,500', '2026년'])}\n\n뒤 문단`)
    expect(PictureMarks.strip(text)).toBe('앞 문단\n\n뒤 문단')
  })

  it('finds each slide\'s pictures through its own relationships', async () => {
    const parts: string[] = []
    const slides = await pptxText(new Uint8Array(await pptx()), part => { parts.push(part); return '' })
    expect(slides.map(s => s.text)).toEqual(['매출 추이', ''])
    expect(parts).toEqual(['ppt/media/image3.png', 'ppt/media/image9.png'])
  })

  it('follows a sheet to its drawing to its pictures, in drawing order', async () => {
    const pictures = await sheetPictures(new Uint8Array(await xlsx()))
    expect([...pictures]).toEqual([['견적 & 도장', ['xl/media/logo.png', 'xl/media/seal.png']]])
  })

  it('takes a message\'s inline and attached pictures, not its other attachments', () => {
    const pictures = emlPictures(new Uint8Array(Buffer.from(EML)))
    expect(pictures.map(p => p.name)).toEqual(['picture 1 in the message', 'scan.png'])
    expect(pictures.every(p => pictureExtension(p.bytes) === 'png')).toBe(true)
  })

  it('knows the pictures OCR can read by their bytes', () => {
    expect(pictureExtension(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    expect(pictureExtension(new Uint8Array([0x49, 0x49, 0x2a, 0x00]))).toBe('tif')
    expect(pictureExtension(new Uint8Array([0x01, 0x00, 0x00, 0x00]))).toBeNull() // EMF
  })
})

describe('doc_get_text and OCR', () => {
  it('leaves a document with text alone in auto mode — the app is never asked', async () => {
    noApp()
    expect(await callTool('doc_get_text', { file: at('그림.docx') })).toBe('앞 문단\n\n뒤 문단')
    const deck = await callTool('doc_get_text', { file: at('덱.pptx'), ocr: 'off' })
    expect(deck).toContain('── Slide 2 ──\n(no text)')
  })

  it('without the app, says OCR is unavailable and still returns the text', async () => {
    noApp()
    const text = await callTool('doc_get_text', { file: at('그림.docx'), ocr: 'images' })
    expect(text).toMatch(/^앞 문단\n\n뒤 문단\n\n\(OCR unavailable: WZPDF_APP does not exist/)
    // auto: only the slide that is nothing but a picture needs it.
    const deck = await callTool('doc_get_text', { file: at('덱.pptx') })
    expect(deck).toContain('매출 추이')
    expect(deck).toContain('(OCR unavailable')
    await expect(callTool('doc_get_text', { file: at('사진.png') })).rejects.toThrow(/WZPDF_APP/)
  })

  it('refuses an unknown ocr mode and a picture with OCR off', async () => {
    await expect(callTool('doc_get_text', { file: at('그림.docx'), ocr: 'yes' })).rejects.toThrow(/ocr must be/)
    await expect(callTool('doc_get_text', { file: at('사진.png'), ocr: 'off' })).rejects.toThrow(/no text of its own/)
    await expect(callTool('doc_get_text', { file: at('그림.docx'), ocrMaxPages: 0 })).rejects.toThrow(/ocrMaxPages/)
  })
})
