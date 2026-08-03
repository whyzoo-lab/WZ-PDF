// src/services/markdownDoc.ts
//
// Markdown → a readable document.
//
// Like mail, Markdown reflows and has no page geometry, so it renders as HTML
// rather than going through the canvas/page pipeline — putting it on a canvas
// would throw away selectable text and searchability for nothing.
//
// Unlike mail, this is a *document* rather than a message: remote images are
// allowed, because a README's badges and diagrams are the content, and a .md
// file is not a delivery vehicle aimed at the reader the way an email is. The
// rest of the hardening is the same — Markdown may contain raw HTML, so the
// output is still sanitized before it is shown.

import DOMPurify from 'dompurify'

export interface MarkdownEntry {
  /** Heading depth, 1-6. */
  level: number
  text: string
  /** Matches the id put on the heading, for in-page links. */
  id: string
}

export interface RenderedMarkdown {
  html: string
  /** Document title: front-matter `title`, else the first H1, else null. */
  title: string | null
  /** Headings, for the contents sidebar. */
  outline: MarkdownEntry[]
}

/** Tags that execute, embed, or restyle beyond their own subtree. */
const FORBID_TAGS = [
  'script', 'style', 'link', 'meta', 'base', 'title',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'form', 'input', 'button', 'select', 'textarea',
]

/**
 * Remove YAML front matter and pull out a `title:` if present.
 *
 * Notes exported from other tools nearly always start with a `---` block. marked
 * renders it as a horizontal rule followed by stray `key: value` lines, which is
 * the first thing that makes a file look "not properly rendered".
 */
function splitFrontMatter(src: string): { body: string; title: string | null } {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src)
  if (!m) return { body: src, title: null }
  const title = /^title:[ \t]*(.+)$/m.exec(m[1])?.[1]?.trim() ?? null
  return {
    body: src.slice(m[0].length),
    // Front matter values are often quoted.
    title: title ? title.replace(/^["']|["']$/g, '') : null,
  }
}

/** GitHub-style slug, so an outline link matches its heading. */
function slugify(text: string, taken: Set<string>): string {
  const base = text.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')   // keep letters/numbers (incl. Hangul)
    .replace(/\s+/g, '-')
    || 'section'
  let id = base, n = 1
  while (taken.has(id)) id = `${base}-${++n}`
  taken.add(id)
  return id
}

/** Parse and sanitize Markdown for display. */
export async function renderMarkdown(source: string): Promise<RenderedMarkdown> {
  const { marked } = await import('marked')
  const { body, title: frontTitle } = splitFrontMatter(source)

  const raw = await marked.parse(body, {
    gfm: true,      // tables, strikethrough, autolinks, task lists
    breaks: false,  // a single newline is not a line break, per CommonMark
  })

  // GFM task lists arrive as disabled checkboxes. `input` is forbidden below, so
  // fold the state into a class first — sanitising first would delete the box
  // and take the done/todo distinction with it. This rewrites marked's own
  // output (a shape we control), and the result still goes through DOMPurify.
  const withTasks = raw.replace(
    /<li>\s*<input([^>]*?)type="checkbox"([^>]*?)>/gi,
    (_m, before: string, after: string) => {
      const done = /checked/i.test(before + after)
      return `<li class="wz-md-task ${done ? 'is-done' : 'is-todo'}">`
    },
  )

  const clean = DOMPurify.sanitize(withTasks, {
    FORBID_TAGS,
    FORBID_ATTR: ['ping', 'formaction'],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data):|[./#])/i,
  })

  // Post-process detached, so nothing here loads or executes.
  const doc = new DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html')

  const taken = new Set<string>()
  const outline: MarkdownEntry[] = []
  for (const h of Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
    const text = (h.textContent ?? '').trim()
    if (!text) continue
    const id = slugify(text, taken)
    h.setAttribute('id', id)
    outline.push({ level: Number(h.tagName[1]), text, id })
  }

  // Links leave the app rather than navigating it — except in-page anchors,
  // which are how the outline works.
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    if ((a.getAttribute('href') ?? '').startsWith('#')) continue
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  }

  const firstH1 = doc.querySelector('h1')?.textContent?.trim() || null
  return { html: doc.body.innerHTML, title: frontTitle ?? firstH1, outline }
}
