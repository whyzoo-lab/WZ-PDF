// src/services/emailHtml.ts
//
// Turning message HTML into something safe to put on screen.
//
// Mail bodies are attacker-controlled, so this does three separate jobs and
// keeps them separate on purpose:
//   1. sanitize      — DOMPurify strips scripts, event handlers, javascript:
//                      URLs and framing tags.
//   2. de-fang layout— <style>/<link> are dropped so a message cannot restyle
//                      the app around it; inline style attributes survive,
//                      which is where almost all real email formatting lives.
//                      DOMPurify does NOT inspect their contents (`style` is
//                      on its URI-safe list), so `url(...)` is handled below.
//   3. block pixels  — remote images are held back until the reader asks for
//                      them, because loading one silently reports "opened" to
//                      the sender. cid: parts were already inlined as data:
//                      URLs by the parser, so normal mail still looks right.

import DOMPurify from 'dompurify'

export interface RenderedEmailHtml {
  html: string
  /** How many remote images were withheld — lets the UI offer to load them. */
  blockedImages: number
}

/** Tags that either execute, embed, or restyle beyond their own subtree. */
const FORBID_TAGS = [
  'script', 'style', 'link', 'meta', 'base', 'title',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'form', 'input', 'button', 'select', 'textarea',
]

const FORBID_ATTR = ['srcset', 'ping', 'formaction', 'background']

/**
 * Would this URL make the browser go to the network?
 *
 * Decided by the browser's own parser, not a regex. `http:evil.com/p.png`,
 * `http:/evil.com/p.png`, `http:\\evil.com/p.png` and a URL with a tab in its
 * scheme all resolve to `http://evil.com/…` yet none of them starts with `//`
 * — a prefix test let every one of them through the gate. Anything that is
 * not an inline `data:` image counts as remote.
 */
function isRemote(raw: string): boolean {
  let parsed: URL
  try { parsed = new URL(raw, 'https://placeholder.invalid/') } catch { return true }
  if (parsed.protocol === 'data:') return !/^data:image\//i.test(raw.trim())
  return true
}

/** Every attribute through which an element can fetch something. */
const LOADING_ATTRS = ['src', 'poster', 'href', 'xlink:href']
/** Every element that fetches through one of those. */
const LOADING_TAGS = 'img, video, audio, source, track, image, feImage'

/**
 * Sanitize a message body and gate its remote images.
 *
 * @param showRemoteImages let images load from the network (an explicit,
 *        per-message choice by the reader — never the default).
 */
export function renderEmailHtml(rawHtml: string, showRemoteImages = false): RenderedEmailHtml {
  const clean = DOMPurify.sanitize(rawHtml, {
    FORBID_TAGS,
    FORBID_ATTR,
    ALLOW_DATA_ATTR: false,
    // Which URLs may appear in any attribute. `cid:` is absent on purpose: the
    // parser rewrites those to data: URLs, and one still pointing at a cid here
    // cannot be resolved anyway. Scheme-relative `//host/x` is allowed through
    // so the image gate below can see it — dropping it at this stage would
    // silently lose legitimate images with no way to opt back in.
    // No `data:` here on purpose: listing it would allow data: on *every* URI
    // attribute, including <a href>, where a data:text/html link is a page.
    // DOMPurify still permits data: on img/video/audio/source/track/image by
    // its own separate rule, which is the only place it is wanted.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|\/\/)/i,
  })

  // Post-process in a detached document so nothing here can execute or load:
  // images in a template's content are inert until it is adopted.
  const doc = new DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html')

  let blockedImages = 0
  // Deny by default, over every element and attribute that can load. It used
  // to gate <img src> alone, which left <video poster>, <source src>, SVG
  // <image href> and the like free to fire the very tracking pixel the gate
  // exists to stop.
  for (const el of Array.from(doc.querySelectorAll(LOADING_TAGS))) {
    for (const attr of LOADING_ATTRS) {
      const value = el.getAttribute(attr)
      if (value === null || !isRemote(value)) continue   // inlined cid parts are data:image
      if (showRemoteImages) {
        // A scheme-relative URL would resolve against app://, which cannot
        // serve it. Pin it to https so opting in actually shows the picture.
        if (value.trim().startsWith('//')) el.setAttribute(attr, 'https:' + value.trim())
        continue
      }
      el.removeAttribute(attr)
      if (el.tagName.toLowerCase() === 'img' && attr === 'src') {
        el.setAttribute('data-wz-blocked-src', value)
        el.setAttribute('alt', el.getAttribute('alt') || '')
      }
      blockedImages++
    }
  }

  // Inline styles can load too: background-image, list-style-image, cursor.
  // The whole attribute goes when it mentions a URL, since a mangled style is
  // better than a beacon.
  if (!showRemoteImages) {
    for (const el of Array.from(doc.querySelectorAll('[style]'))) {
      const style = el.getAttribute('style') ?? ''
      if (/url\s*\(|@import|image-set\s*\(/i.test(style)) {
        el.removeAttribute('style')
        blockedImages++
      }
    }
  }

  // Links leave the app rather than navigating it. The main process already
  // refuses in-app navigation and hands http(s) to the OS browser; this makes
  // the intent explicit and stops the opened page reaching back via window.opener.
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  }

  return { html: doc.body.innerHTML, blockedImages }
}

/** Plain-text bodies: escape, then linkify bare URLs so they stay clickable. */
export function renderEmailText(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped.replace(
    /\bhttps?:\/\/[^\s<>"']+/g,
    url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`,
  )
}
