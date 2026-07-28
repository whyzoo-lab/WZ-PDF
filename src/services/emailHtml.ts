// src/services/emailHtml.ts
//
// Turning message HTML into something safe to put on screen.
//
// Mail bodies are attacker-controlled, so this does three separate jobs and
// keeps them separate on purpose:
//   1. sanitize      — DOMPurify strips scripts, event handlers, javascript:
//                      URLs and framing tags.
//   2. de-fang layout— <style>/<link> are dropped so a message cannot restyle
//                      the app around it; inline style attributes survive
//                      (DOMPurify sanitizes their contents), which is where
//                      almost all real email formatting lives anyway.
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

function isRemote(url: string): boolean {
  return /^(https?:)?\/\//i.test(url.trim())
}

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
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data):|\/\/)/i,
  })

  // Post-process in a detached document so nothing here can execute or load:
  // images in a template's content are inert until it is adopted.
  const doc = new DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html')

  let blockedImages = 0
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (!isRemote(src)) continue          // data: URLs (inlined cid parts) are fine
    if (showRemoteImages) {
      // A scheme-relative URL would resolve against app://, which cannot serve
      // it. Pin it to https so opting in actually shows the picture.
      if (src.trim().startsWith('//')) img.setAttribute('src', 'https:' + src.trim())
      continue
    }
    img.removeAttribute('src')
    img.setAttribute('data-wz-blocked-src', src)
    img.setAttribute('alt', img.getAttribute('alt') || '')
    blockedImages++
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
