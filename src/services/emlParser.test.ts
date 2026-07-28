import { describe, it, expect } from 'vitest'
import { parseEml } from './emlParser'

/** Build .eml bytes. Segments given as byte arrays are spliced in verbatim so a
 *  test can carry a real non-UTF-8 (e.g. EUC-KR) body. */
function eml(...parts: Array<string | number[]>): Uint8Array {
  const chunks = parts.map(p =>
    typeof p === 'string' ? new TextEncoder().encode(p) : new Uint8Array(p),
  )
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

const b64 = (s: string) => btoa(s)

describe('parseEml', () => {
  it('reads headers and a plain-text body', () => {
    const m = parseEml(eml(
      'From: Alice <alice@example.com>\r\n' +
      'To: bob@example.com\r\n' +
      'Subject: Hello there\r\n' +
      'Date: Mon, 1 Jan 2026 09:00:00 +0900\r\n' +
      'Content-Type: text/plain; charset="utf-8"\r\n' +
      '\r\n' +
      'Body line one.\r\n',
    ))
    expect(m.subject).toBe('Hello there')
    expect(m.from).toContain('alice@example.com')
    expect(m.to).toBe('bob@example.com')
    expect(m.date).toContain('2026')
    expect(m.text).toContain('Body line one.')
    expect(m.attachments).toHaveLength(0)
  })

  it('decodes an RFC 2047 base64 encoded-word subject (Korean)', () => {
    const subject = '회의 자료 첨부'
    const encoded = '=?UTF-8?B?' + b64(String.fromCharCode(...new TextEncoder().encode(subject))) + '?='
    const m = parseEml(eml(`Subject: ${encoded}\r\nContent-Type: text/plain\r\n\r\nx\r\n`))
    expect(m.subject).toBe(subject)
  })

  it('decodes a Q encoded-word, treating _ as space', () => {
    const m = parseEml(eml('Subject: =?utf-8?Q?Quarterly_Report=21?=\r\n\r\nx\r\n'))
    expect(m.subject).toBe('Quarterly Report!')
  })

  it('joins adjacent encoded-words without inserting whitespace', () => {
    // Long Korean subjects get split across several encoded-words.
    const a = '=?UTF-8?B?' + b64(String.fromCharCode(...new TextEncoder().encode('한국'))) + '?='
    const b = '=?UTF-8?B?' + b64(String.fromCharCode(...new TextEncoder().encode('산업단지'))) + '?='
    const m = parseEml(eml(`Subject: ${a}\r\n ${b}\r\n\r\nx\r\n`))
    expect(m.subject).toBe('한국산업단지')
  })

  it('decodes a EUC-KR body using the declared charset', () => {
    // '안녕' in EUC-KR — proves we decode per-part instead of assuming UTF-8.
    const m = parseEml(eml(
      'Subject: t\r\nContent-Type: text/plain; charset="euc-kr"\r\n\r\n',
      [0xbe, 0xc8, 0xb3, 0xe7],
    ))
    expect(m.text?.trim()).toBe('안녕')
  })

  it('prefers the HTML alternative and still keeps the text one', () => {
    const m = parseEml(eml(
      'Subject: t\r\n' +
      'Content-Type: multipart/alternative; boundary="BB"\r\n\r\n' +
      '--BB\r\nContent-Type: text/plain; charset="utf-8"\r\n\r\nplain version\r\n' +
      '--BB\r\nContent-Type: text/html; charset="utf-8"\r\n\r\n<p>rich version</p>\r\n' +
      '--BB--\r\n',
    ))
    expect(m.html).toContain('rich version')
    expect(m.text).toContain('plain version')
  })

  it('extracts a base64 attachment with its bytes intact', () => {
    const pdfBytes = '%PDF-1.4\nbinary\x00\xff stuff'
    const m = parseEml(eml(
      'Subject: t\r\n' +
      'Content-Type: multipart/mixed; boundary="MM"\r\n\r\n' +
      '--MM\r\nContent-Type: text/plain\r\n\r\nsee attached\r\n' +
      '--MM\r\n' +
      'Content-Type: application/pdf; name="report.pdf"\r\n' +
      'Content-Disposition: attachment; filename="report.pdf"\r\n' +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      b64(pdfBytes) + '\r\n' +
      '--MM--\r\n',
    ))
    expect(m.attachments).toHaveLength(1)
    const a = m.attachments[0]
    expect(a.filename).toBe('report.pdf')
    expect(a.mimeType).toBe('application/pdf')
    expect(a.size).toBe(pdfBytes.length)
    // Byte-exact: the binary round-trip must not mangle high bytes or NULs.
    expect(String.fromCharCode(...a.bytes)).toBe(pdfBytes)
  })

  it('decodes an RFC 2231 split, percent-encoded filename', () => {
    // How a Korean filename commonly arrives.
    const m = parseEml(eml(
      'Subject: t\r\n' +
      'Content-Type: multipart/mixed; boundary="MM"\r\n\r\n' +
      '--MM\r\n' +
      'Content-Type: application/pdf\r\n' +
      "Content-Disposition: attachment; filename*0*=UTF-8''%EA%B3%84; filename*1*=%EC%95%BD%EC%84%9C.pdf\r\n" +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      b64('x') + '\r\n' +
      '--MM--\r\n',
    ))
    expect(m.attachments[0].filename).toBe('계약서.pdf')
  })

  it('decodes an encoded-word filename', () => {
    const name = '=?UTF-8?B?' + b64(String.fromCharCode(...new TextEncoder().encode('보고서.pdf'))) + '?='
    const m = parseEml(eml(
      'Content-Type: multipart/mixed; boundary="MM"\r\n\r\n' +
      '--MM\r\n' +
      `Content-Type: application/pdf\r\nContent-Disposition: attachment; filename="${name}"\r\n` +
      'Content-Transfer-Encoding: base64\r\n\r\n' + b64('x') + '\r\n' +
      '--MM--\r\n',
    ))
    expect(m.attachments[0].filename).toBe('보고서.pdf')
  })

  it('inlines cid: images as data URLs and hides them from the attachment list', () => {
    const m = parseEml(eml(
      'Content-Type: multipart/related; boundary="RR"\r\n\r\n' +
      '--RR\r\nContent-Type: text/html\r\n\r\n<img src="cid:logo123">\r\n' +
      '--RR\r\n' +
      'Content-Type: image/png\r\nContent-ID: <logo123>\r\n' +
      'Content-Disposition: inline\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
      b64('PNGDATA') + '\r\n' +
      '--RR--\r\n',
    ))
    expect(m.html).toContain('data:image/png;base64,')
    expect(m.html).not.toContain('cid:logo123')
    expect(m.attachments).toHaveLength(0) // inline art isn't a download
  })

  it('decodes quoted-printable bodies including soft line breaks', () => {
    const m = parseEml(eml(
      'Content-Type: text/plain; charset="utf-8"\r\n' +
      'Content-Transfer-Encoding: quoted-printable\r\n\r\n' +
      'a very long line that was=\r\n wrapped, plus =41=42\r\n',
    ))
    expect(m.text).toContain('a very long line that was wrapped, plus AB')
  })

  it('handles nested multipart (mixed > alternative) and finds the attachment', () => {
    const m = parseEml(eml(
      'Content-Type: multipart/mixed; boundary="OUT"\r\n\r\n' +
      '--OUT\r\nContent-Type: multipart/alternative; boundary="IN"\r\n\r\n' +
      '--IN\r\nContent-Type: text/plain\r\n\r\nplain\r\n' +
      '--IN\r\nContent-Type: text/html\r\n\r\n<b>html</b>\r\n' +
      '--IN--\r\n' +
      '--OUT\r\n' +
      'Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="a.bin"\r\n' +
      'Content-Transfer-Encoding: base64\r\n\r\n' + b64('DATA') + '\r\n' +
      '--OUT--\r\n',
    ))
    expect(m.html).toContain('<b>html</b>')
    expect(m.text).toContain('plain')
    expect(m.attachments.map(a => a.filename)).toEqual(['a.bin'])
  })

  it('does not throw on a truncated or malformed message', () => {
    expect(() => parseEml(eml('Subject: broken\r\nContent-Type: multipart/mixed; boundary="Z"\r\n\r\n--Z\r\n'))).not.toThrow()
    expect(() => parseEml(eml(''))).not.toThrow()
  })
})
