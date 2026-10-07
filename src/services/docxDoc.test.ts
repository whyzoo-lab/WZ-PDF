import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { renderDocx, sanitizeDocxCss, sanitizeDocxBody, cssValueIsLocal, DOCX_CLASS } from './docxDoc'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** The smallest .docx Word would open: one body, one relationship. */
async function makeDocx(bodyXml: string, rels = ''): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>
</Relationships>`)
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`)
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${bodyXml}</w:body></w:document>`)
  return zip.generateAsync({ type: 'arraybuffer' })
}

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`

describe('renderDocx', () => {
  it('renders the text of the document', async () => {
    const out = await renderDocx(await makeDocx(para('계약서 본문입니다')))
    expect(out.html).toContain('계약서 본문입니다')
    expect(out.html).toContain(`${DOCX_CLASS}-wrapper`)
  })

  it('drops a javascript: hyperlink and sends a web link outside the app', async () => {
    const body =
      `<w:p><w:hyperlink r:id="rId8"><w:r><w:t>evil</w:t></w:r></w:hyperlink></w:p>` +
      `<w:p><w:hyperlink r:id="rId9"><w:r><w:t>web</w:t></w:r></w:hyperlink></w:p>`
    const rels =
      `<Relationship Id="rId8" Type="${R}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>` +
      `<Relationship Id="rId9" Type="${R}/hyperlink" Target="https://example.com/" TargetMode="External"/>`
    const out = await renderDocx(await makeDocx(body, rels))
    const doc = new DOMParser().parseFromString(out.html, 'text/html')
    const links = Array.from(doc.querySelectorAll('a'))
    expect(out.html).not.toMatch(/javascript:/i)
    const web = links.find(a => a.textContent === 'web')
    expect(web?.getAttribute('href')).toBe('https://example.com/')
    expect(web?.getAttribute('target')).toBe('_blank')
  })

  it('keeps every style rule inside the document', async () => {
    const out = await renderDocx(await makeDocx(para('x')))
    expect(out.css.length).toBeGreaterThan(0)
    for (const line of out.css.split('\n').filter(l => l.includes('{') && !l.startsWith('@'))) {
      const selector = line.slice(0, line.indexOf('{'))
      for (const part of selector.split(',')) expect(part).toContain(`.${DOCX_CLASS}`)
    }
  })
})

describe('sanitizeDocxCss', () => {
  it('drops a rule that escapes the document scope', () => {
    const css = `.${DOCX_CLASS} p { color: red; } body { display: none; } .${DOCX_CLASS} a, html { color: blue; }`
    const out = sanitizeDocxCss(css)
    expect(out).toContain('color: red')
    expect(out).not.toMatch(/display:\s*none/)
    expect(out).not.toContain('blue')
  })

  it('removes a declaration that would fetch from the network', () => {
    const css = `.${DOCX_CLASS} p { color: red; background-image: url(https://evil.example/pixel.png); }`
    const out = sanitizeDocxCss(css)
    expect(out).toContain('color: red')
    expect(out).not.toContain('evil.example')
  })

  it('drops @import, @font-face and @page', () => {
    const css = `@import url(https://evil.example/a.css); @font-face { font-family: X; src: url(blob:x) }
      @page { margin: 0 } .${DOCX_CLASS} { color: black; }`
    const out = sanitizeDocxCss(css)
    expect(out).not.toMatch(/@import|@font-face|@page/)
    expect(out).toContain('color: black')
  })
})

describe('cssValueIsLocal', () => {
  it('accepts blob: and inline images only', () => {
    expect(cssValueIsLocal('url(blob:app://bundle/1234)')).toBe(true)
    expect(cssValueIsLocal('url("data:image/png;base64,AA==")')).toBe(true)
    expect(cssValueIsLocal('url(https://evil.example/x)')).toBe(false)
    expect(cssValueIsLocal('url(//evil.example/x)')).toBe(false)
    expect(cssValueIsLocal('url("data:text/html,<b>")')).toBe(false)
  })

  it('sees through escapes, which can spell url( without those letters', () => {
    expect(cssValueIsLocal('\\75 rl(https://evil.example/x)')).toBe(false)
    expect(cssValueIsLocal('u\\72 l(https://evil.example/x)')).toBe(false)
  })

  it('keeps the escapes docx-preview writes for list bullets', () => {
    expect(cssValueIsLocal('"\\9 "')).toBe(true)
    expect(sanitizeDocxCss(`p.${DOCX_CLASS}-num-1-0:before { content: "\\2022"; }`)).toContain('content')
  })

  it('turns Word\'s Symbol-font bullet into a character the browser can draw', () => {
    const out = sanitizeDocxCss(`p.${DOCX_CLASS}-num-1-0:before { content: "\\9"; font-family: Symbol; }`)
    expect(out).toContain('•')
    expect(out).not.toContain('')
  })
})

describe('sanitizeDocxBody', () => {
  it('strips frames, scripts and remote pictures', () => {
    const html = `<div><iframe srcdoc="<script>alert(1)</script>"></iframe><script>alert(2)</script>
      <img src="https://evil.example/p.png"><img src="blob:app://bundle/ok">
      <svg><image href="https://evil.example/s.png"></image></svg>
      <p style="background:url(https://evil.example/b.png)">text</p></div>`
    const out = sanitizeDocxBody(html)
    expect(out).not.toMatch(/iframe|script|evil\.example/)
    expect(out).toContain('blob:app://bundle/ok')
    expect(out).toContain('text')
  })
})
