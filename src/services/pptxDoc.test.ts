import { describe, it, expect } from 'vitest'
import { stripExternalMedia, isOpenableLink } from './pptxDoc'

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const rels = (...items: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`

describe('stripExternalMedia', () => {
  it('removes a picture the slide links to on the web, keeping everything else', () => {
    const xml = rels(
      `<Relationship Id="rId1" Type="${R}/image" Target="https://evil.example/pixel.png" TargetMode="External"/>`,
      `<Relationship Id="rId2" Type="${R}/image" Target="../media/image1.png"/>`,
      `<Relationship Id="rId3" Type="${R}/hyperlink" Target="https://example.com/" TargetMode="External"/>`,
      `<Relationship Id="rId4" Type="${R}/video" Target="https://evil.example/v.mp4" TargetMode="External"/>`,
    )
    const out = stripExternalMedia(xml)
    expect(out).not.toContain('evil.example')
    expect(out).toContain('../media/image1.png')
    expect(out).toContain('https://example.com/')
  })

  it('leaves a part without external targets byte for byte', () => {
    const xml = rels(`<Relationship Id="rId2" Type="${R}/image" Target="../media/image1.png"/>`)
    expect(stripExternalMedia(xml)).toBe(xml)
  })
})

describe('isOpenableLink', () => {
  it('opens web and mail links only', () => {
    expect(isOpenableLink('https://example.com')).toBe(true)
    expect(isOpenableLink('mailto:a@b.c')).toBe(true)
    expect(isOpenableLink('javascript:alert(1)')).toBe(false)
    expect(isOpenableLink('file:///c:/windows/system32/calc.exe')).toBe(false)
  })
})
