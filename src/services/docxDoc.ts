// src/services/docxDoc.ts
//
// Word (.docx) → HTML that is safe to put on screen, via docx-preview.
//
// A document someone sent is attacker-controlled, and docx-preview is a
// renderer, not a sanitizer: it copies relationship targets into <a href>
// (a `javascript:` target included), shows altChunk HTML in an <iframe
// srcdoc>, and builds its stylesheet by string concatenation from values in the
// file — so a crafted colour can close the rule and restyle the app, or add a
// `url()` that reports the document was opened. Nothing it produces is trusted:
//   1. it renders into detached nodes (`renderDocument`, not `renderAsync`),
//      with altChunks, comments and embedded fonts switched off;
//   2. the body goes through DOMPurify, then a deny-by-default gate on every
//      attribute that can load something — only blob:/data:image pass, which is
//      all docx-preview itself ever makes for pictures;
//   3. the stylesheet is re-parsed by the browser and rebuilt rule by rule:
//      a rule survives only if every selector is scoped to the document's own
//      class, and a declaration only if each url() in it is local.
// The library itself is not patched (see "Never patch a dependency in place").

import DOMPurify from 'dompurify'
import { openLinksOutside } from './links'

/** docx-preview's class prefix; every rule it writes is scoped under it. */
export const DOCX_CLASS = 'wz-docx'

export interface RenderedDocx {
  html: string
  css: string
  /** Blob URLs docx-preview made for pictures — revoke when the view goes. */
  objectUrls: string[]
}

/** Tags that execute, embed, frame or restyle beyond their own subtree. */
const FORBID_TAGS = [
  'script', 'style', 'link', 'meta', 'base', 'title',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'form', 'input', 'button', 'select', 'textarea',
]
const FORBID_ATTR = ['srcset', 'ping', 'formaction', 'background']
const LOADING_ATTRS = ['src', 'poster', 'href', 'xlink:href']
const LOADING_TAGS = 'img, video, audio, source, track, image, feImage, use'

/** Only what this document carried inside itself: blob: and inline images. */
function isLocalResource(raw: string): boolean {
  const value = raw.trim()
  return /^blob:/i.test(value) || /^data:image\//i.test(value)
}

/** Resolve CSS escapes (`\75` → `u`, `\(` → `(`), so they cannot hide a `url(`. */
function unescapeCss(value: string): string {
  return value
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => {
      const cp = parseInt(hex, 16)
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '�'
    })
    .replace(/\\([^\n])/g, '$1')
}

/**
 * True when every url() in a CSS value points at something local.
 *
 * Checked after resolving escapes: `\75 rl(` is `url(` to the CSS parser.
 * Escapes are not refused outright, because docx-preview writes them itself
 * for list bullets (`content: "\9"`).
 */
export function cssValueIsLocal(raw: string): boolean {
  const value = unescapeCss(raw)
  if (/image-set\s*\(|@import|expression\s*\(/i.test(value)) return false
  const opened = value.match(/url\s*\(/gi)?.length ?? 0
  let checked = 0
  for (const m of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']*))\s*\)/gi)) {
    checked++
    if (!isLocalResource(m[1] ?? m[2] ?? m[3] ?? '')) return false
  }
  return checked === opened
}

// CSSRule.type — deprecated but present in Chromium and jsdom, and unlike
// `instanceof` it does not depend on which realm made the rule.
const STYLE_RULE = 1
const MEDIA_RULE = 4

interface RuleLike {
  type: number
  selectorText?: string
  style?: CSSStyleDeclaration
  media?: { mediaText: string }
  cssRules?: ArrayLike<RuleLike>
}

/**
 * Word list bullets as they are stored: a private-use code point that only
 * means something in the Symbol or Wingdings font (U+F0B7 is "•" in Symbol).
 * Chromium draws nothing for them, so docx-preview's bulleted lists came out
 * with no bullets. Mapped to the Unicode character they stand for; anything
 * unrecognised in that range becomes a plain bullet.
 */
const SYMBOL_BULLETS: Record<number, string> = {
  0xf0b7: '•', 0xf06c: '●', 0xf06e: '■', 0xf0a7: '▪', 0xf071: '❑', 0xf076: '❖',
  0xf0d8: '➢', 0xf0e8: '➔', 0xf0fc: '✔', 0xf0fe: '☑', 0xf02d: '−', 0xf0a8: '◆',
}
function mapSymbolBullets(value: string): string {
  return value.replace(/[-]/g, ch => SYMBOL_BULLETS[ch.codePointAt(0)!] ?? '•')
}

function rebuildDeclarations(style: CSSStyleDeclaration): string {
  const out: string[] = []
  for (let i = 0; i < style.length; i++) {
    const name = style[i]
    let value = style.getPropertyValue(name)
    if (name === 'content') value = mapSymbolBullets(value)
    if (!cssValueIsLocal(value)) continue
    const important = style.getPropertyPriority(name) ? ' !important' : ''
    out.push(`${name}: ${value}${important};`)
  }
  return out.join(' ')
}

function rebuildRules(rules: ArrayLike<RuleLike>, scope: string, out: string[]): void {
  for (const rule of Array.from(rules)) {
    if (rule.type === STYLE_RULE && rule.selectorText && rule.style) {
      // Every selector in the list, not just one: `.wz-docx p, body` would
      // otherwise reach the app around the document.
      const scoped = rule.selectorText.split(',').every(part => part.includes(`.${scope}`))
      if (!scoped) continue
      const body = rebuildDeclarations(rule.style)
      if (body) out.push(`${rule.selectorText} { ${body} }`)
    } else if (rule.type === MEDIA_RULE && rule.cssRules && rule.media) {
      const inner: string[] = []
      rebuildRules(rule.cssRules, scope, inner)
      if (inner.length) out.push(`@media ${rule.media.mediaText} { ${inner.join('\n')} }`)
    }
    // Everything else — @import, @font-face, @page, @keyframes, @namespace —
    // is dropped. None is needed to read a document, and @page would reach the
    // app's own print layout.
  }
}

/**
 * Rebuild a stylesheet keeping only scoped rules with local URLs.
 *
 * Parsed by the browser into a constructed sheet that is never adopted, so
 * nothing in it applies or loads while it is inspected (`replaceSync` also
 * ignores @import outright).
 */
export function sanitizeDocxCss(css: string, scope = DOCX_CLASS): string {
  const sheet = new CSSStyleSheet()
  try {
    sheet.replaceSync(css)
  } catch {
    return ''
  }
  const out: string[] = []
  rebuildRules(sheet.cssRules as unknown as ArrayLike<RuleLike>, scope, out)
  return out.join('\n')
}

/** Sanitize rendered body HTML; see the module comment for what goes. */
export function sanitizeDocxBody(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    FORBID_TAGS,
    FORBID_ATTR,
    // `blob:` for pictures; `#` for in-document bookmarks. No `data:`: on an
    // <a href> a data:text/html link is a page (DOMPurify still permits
    // data:image on <img> by its own rule).
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob):|#)/i,
  })
  const doc = new DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html')

  for (const el of Array.from(doc.querySelectorAll(LOADING_TAGS))) {
    for (const attr of LOADING_ATTRS) {
      const value = el.getAttribute(attr)
      if (value !== null && !isLocalResource(value)) el.removeAttribute(attr)
    }
  }
  // Inline styles can load too (background-image and friends).
  for (const el of Array.from(doc.querySelectorAll('[style]'))) {
    if (!cssValueIsLocal(el.getAttribute('style') ?? '')) el.removeAttribute('style')
  }
  // A blob: link would open one of our own object URLs in a window.
  for (const a of Array.from(doc.querySelectorAll('a[href^="blob:" i]'))) a.removeAttribute('href')
  openLinksOutside(doc, true)
  return doc.body.innerHTML
}

/** Render a .docx into sanitized HTML plus a scoped stylesheet. */
export async function renderDocx(bytes: ArrayBuffer): Promise<RenderedDocx> {
  const { parseAsync, renderDocument } = await import('docx-preview')
  const options = {
    className: DOCX_CLASS,
    inWrapper: true,
    breakPages: true,
    // Break pages where Word last broke them — it writes those positions into
    // the file — so page N here is page N in Word, and the page list and a
    // PDF of the document have Word's pages rather than one per section.
    ignoreLastRenderedPageBreak: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    // altChunk is a foreign document (HTML, RTF…) shown in an <iframe srcdoc>.
    renderAltChunks: false,
    renderComments: false,
    renderChanges: false,
    // Embedded fonts would be registered under the names the file gives them —
    // the app's own UI faces included. Installed fonts render the same text.
    ignoreFonts: true,
    useBase64URL: false,
    experimental: false,
  }
  const parsed = await parseAsync(new Blob([bytes]), options)
  const nodes = await renderDocument(parsed, options)

  const css: string[] = []
  const body: string[] = []
  for (const node of nodes) {
    if (node.nodeName === 'STYLE') { css.push(node.textContent ?? ''); continue }
    if (node instanceof Element) {
      // A <style> nested in the body would be lost to DOMPurify; its rules go
      // through the stylesheet path like the rest.
      for (const s of Array.from(node.querySelectorAll('style'))) {
        css.push(s.textContent ?? '')
        s.remove()
      }
      body.push(node.outerHTML)
    }
  }
  const rawHtml = body.join('')
  const rawCss = css.join('\n')
  const objectUrls = Array.from(new Set((rawHtml + rawCss).match(/blob:[^"'()\s<>]+/g) ?? []))
  return { html: sanitizeDocxBody(rawHtml), css: sanitizeDocxCss(rawCss), objectUrls }
}
