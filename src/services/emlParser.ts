// src/services/emlParser.ts
//
// A self-contained RFC 5322 / MIME reader for .eml files.
//
// Scope: enough to *show* a saved message and get its attachments out — headers,
// the best body part, and every attachment, including the encodings Korean mail
// actually uses (EUC-KR bodies, RFC 2047 encoded-word subjects, RFC 2231 split
// filenames). It does not verify signatures or decrypt S/MIME.
//
// Everything is parsed from a "binary string" (one char per byte, code 0-255)
// rather than a decoded string: attachments are arbitrary bytes, and decoding
// the whole file as text up front would corrupt them. Text is decoded per part,
// using that part's own declared charset.

export interface EmailAttachment {
  /** Decoded display filename; falls back to a generated one. */
  filename: string
  mimeType: string
  bytes: Uint8Array
  size: number
  /** Content-ID without the angle brackets, when present (for cid: images). */
  contentId?: string
  /** Referenced from the body (inline image) rather than offered as a download. */
  inline: boolean
}

export interface ParsedEmail {
  subject: string
  from: string
  to: string
  cc: string
  date: string
  /** Body HTML, with cid: images already rewritten to data: URLs. NOT sanitized
   *  — the view layer does that; keeping the two steps separate means the
   *  sanitizer choice cannot be silently bypassed here. */
  html: string | null
  /** Plain-text body, used when there is no HTML alternative. */
  text: string | null
  attachments: EmailAttachment[]
}

// ── byte/string plumbing ────────────────────────────────────────────────────

/** Uint8Array → binary string (1 char per byte). Chunked so large attachments
 *  don't blow the argument limit of String.fromCharCode. */
function bytesToBinary(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let out = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return out
}

/** Binary string → bytes. Inverse of bytesToBinary. */
function binaryToBytes(bin: string): Uint8Array {
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff
  return out
}

/** Decode bytes as text using the part's charset, falling back to UTF-8.
 *  Labels like `ks_c_5601-1987` are aliases the Encoding Standard maps to
 *  EUC-KR, so Korean mail decodes without special-casing. */
function decodeText(bin: string, charset?: string): string {
  const bytes = binaryToBytes(bin)
  for (const label of [charset, 'utf-8']) {
    if (!label) continue
    try {
      return new TextDecoder(label as string, { fatal: false }).decode(bytes)
    } catch { /* unknown label — fall through */ }
  }
  return bin
}

// ── transfer encodings ──────────────────────────────────────────────────────

function decodeBase64(s: string): string {
  try {
    return atob(s.replace(/[^A-Za-z0-9+/=]/g, ''))
  } catch {
    return ''
  }
}

/** Quoted-printable → binary string. Handles soft line breaks (`=` at EOL). */
function decodeQuotedPrintable(s: string): string {
  return s
    .replace(/=(?:\r\n|\n|\r)/g, '')                       // soft break: joins lines
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

/** Apply a Content-Transfer-Encoding, returning a binary string. */
function decodeTransfer(body: string, encoding: string): string {
  switch (encoding.toLowerCase().trim()) {
    case 'base64': return decodeBase64(body)
    case 'quoted-printable': return decodeQuotedPrintable(body)
    default: return body // 7bit / 8bit / binary — already the bytes we want
  }
}

// ── headers ─────────────────────────────────────────────────────────────────

type Headers = Map<string, string>

/**
 * RFC 2047 encoded-words: `=?charset?B|Q?text?=`. Used for non-ASCII subjects
 * and filenames. Adjacent encoded-words are joined without the separating
 * whitespace, which is what keeps multi-word Korean subjects intact.
 */
function decodeEncodedWords(input: string): string {
  const joined = input.replace(/(\?=)\s+(=\?)/g, '$1$2')
  return joined.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_full, charset: string, enc: string, text: string) => {
      const bin = enc.toUpperCase() === 'B'
        ? decodeBase64(text)
        // Q differs from plain quoted-printable: `_` means space.
        : decodeQuotedPrintable(text.replace(/_/g, ' '))
      return decodeText(bin, charset.toLowerCase())
    },
  )
}

/** Split a raw part into its header block and body at the first blank line. */
function splitHeadersBody(raw: string): { head: string; body: string } {
  const m = raw.match(/\r?\n\r?\n/)
  if (!m || m.index === undefined) return { head: raw, body: '' }
  return { head: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) }
}

/** Parse a header block: unfold continuation lines, then split on the first colon. */
function parseHeaders(head: string): Headers {
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ')
  const headers: Headers = new Map()
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i < 1) continue
    const name = line.slice(0, i).trim().toLowerCase()
    const value = line.slice(i + 1).trim()
    // Keep the first occurrence; duplicates are almost always trace headers.
    if (!headers.has(name)) headers.set(name, value)
  }
  return headers
}

interface ParamHeader { value: string; params: Record<string, string> }

/**
 * Parse a structured header such as
 *   `multipart/mixed; boundary="x"` or `attachment; filename="a.pdf"`.
 * Also reassembles RFC 2231 continuations (`name*0`, `name*1`, …) and decodes
 * the `name*=charset'lang'pct-encoded` form used for non-ASCII filenames.
 */
function parseParamHeader(raw: string | undefined): ParamHeader {
  if (!raw) return { value: '', params: {} }
  const segments: string[] = []
  let depth = 0, current = ''
  for (const ch of raw) {
    if (ch === '"') depth ^= 1
    if (ch === ';' && !depth) { segments.push(current); current = '' } else current += ch
  }
  segments.push(current)

  const value = (segments.shift() ?? '').trim().toLowerCase()
  const extended: Record<string, string> = {}
  const plain: Record<string, string> = {}

  for (const seg of segments) {
    const i = seg.indexOf('=')
    if (i < 0) continue
    let key = seg.slice(0, i).trim().toLowerCase()
    let val = seg.slice(i + 1).trim().replace(/^"|"$/g, '')
    const isExtended = key.endsWith('*')
    if (isExtended) key = key.slice(0, -1)
    // RFC 2231 continuation index: `filename*0`, `filename*1*`, …
    const cont = key.match(/^(.*)\*(\d+)$/)
    const base = cont ? cont[1] : key
    if (isExtended) {
      // charset'lang'value — only the first segment carries the charset.
      const m = val.match(/^([^']*)'[^']*'(.*)$/)
      if (m) {
        val = decodeText(unpercent(m[2]), m[1].toLowerCase())
      } else {
        val = decodeText(unpercent(val))
      }
      extended[base] = (extended[base] ?? '') + val
    } else {
      plain[base] = (plain[base] ?? '') + val
    }
  }
  // Extended (charset-aware) values win over the ASCII-only fallback.
  const params: Record<string, string> = {}
  for (const [k, v] of Object.entries(plain)) params[k] = decodeEncodedWords(v)
  for (const [k, v] of Object.entries(extended)) params[k] = v
  return { value, params }
}

/** Percent-decoding on a byte level (RFC 2231 values are pct-encoded bytes). */
function unpercent(s: string): string {
  return s.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

// ── MIME tree ───────────────────────────────────────────────────────────────

/** Split a multipart body on its boundary delimiters. */
function splitMultipart(body: string, boundary: string): string[] {
  const delim = '--' + boundary
  const parts: string[] = []
  let current: string[] | null = null
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trimEnd()
    if (trimmed === delim) {
      if (current) parts.push(current.join('\r\n'))
      current = []
      continue
    }
    if (trimmed === delim + '--') {
      if (current) parts.push(current.join('\r\n'))
      current = null
      break
    }
    current?.push(line)
  }
  if (current) parts.push(current.join('\r\n'))
  return parts
}

interface Collected {
  html: string | null
  text: string | null
  attachments: EmailAttachment[]
}

/** Walk one MIME part, accumulating bodies and attachments. */
function walkPart(raw: string, out: Collected, depth = 0): void {
  if (depth > 20) return // pathological nesting guard
  const { head, body } = splitHeadersBody(raw)
  const headers = parseHeaders(head)

  const ct = parseParamHeader(headers.get('content-type') || 'text/plain')
  const cd = parseParamHeader(headers.get('content-disposition'))
  const encoding = headers.get('content-transfer-encoding') ?? '7bit'
  const contentId = headers.get('content-id')?.replace(/^<|>$/g, '')

  if (ct.value.startsWith('multipart/')) {
    const boundary = ct.params.boundary
    if (!boundary) return
    for (const part of splitMultipart(body, boundary)) walkPart(part, out, depth + 1)
    return
  }

  const filename = cd.params.filename || ct.params.name
  // A part is an attachment when it is explicitly marked as one, or when it
  // carries a filename, or when it simply isn't displayable text.
  const isTextBody = (ct.value === 'text/plain' || ct.value === 'text/html') && !filename
  const decoded = decodeTransfer(body, encoding)

  if (isTextBody && cd.value !== 'attachment') {
    const textValue = decodeText(decoded, ct.params.charset?.toLowerCase())
    if (ct.value === 'text/html') {
      // Prefer the richest HTML part; later alternatives usually are the richer ones.
      out.html = out.html ? out.html + textValue : textValue
    } else {
      out.text = out.text ? out.text + textValue : textValue
    }
    return
  }

  const bytes = binaryToBytes(decoded)
  if (bytes.length === 0) return
  out.attachments.push({
    filename: filename || `attachment-${out.attachments.length + 1}${extensionFor(ct.value)}`,
    mimeType: ct.value || 'application/octet-stream',
    bytes,
    size: bytes.length,
    contentId,
    // Only treat it as inline decoration if it is actually referenced by cid.
    inline: cd.value === 'inline' && !!contentId,
  })
}

function extensionFor(mime: string): string {
  const map: Record<string, string> = {
    'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg',
    'image/gif': '.gif', 'text/plain': '.txt', 'text/html': '.html',
  }
  return map[mime] ?? ''
}

/** Replace `cid:` image references with data: URLs so the body renders without
 *  fetching anything from the network. */
function inlineCidImages(html: string, attachments: EmailAttachment[]): string {
  if (!html.includes('cid:')) return html
  // Encoded once per part, whatever the reference count: a body citing the
  // same 5 MB picture a thousand times used to build a thousand base64
  // copies. And only when the part really is an image — the MIME type is the
  // sender's own claim, and `text/html` here would turn an <a href="cid:…">
  // into a data: page.
  const encoded = new Map<string, string | null>()
  const dataUrlFor = (hit: EmailAttachment): string | null => {
    const id = hit.contentId
    if (!id) return null
    if (!encoded.has(id)) {
      encoded.set(id,
        /^image\/[a-z0-9.+-]+$/i.test(hit.mimeType)
          ? `data:${hit.mimeType.toLowerCase()};base64,${btoa(bytesToBinary(hit.bytes))}`
          : null)
    }
    return encoded.get(id) ?? null
  }
  return html.replace(/(["'])cid:([^"']+)\1/gi, (whole, quote: string, id: string) => {
    const hit = attachments.find(a => a.contentId === id)
    const url = hit && dataUrlFor(hit)
    return url ? `${quote}${url}${quote}` : whole
  })
}

/** Parse .eml bytes into a displayable message. */
export function parseEml(input: ArrayBuffer | Uint8Array): ParsedEmail {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const raw = bytesToBinary(bytes)
  const { head } = splitHeadersBody(raw)
  const headers = parseHeaders(head)

  const out: Collected = { html: null, text: null, attachments: [] }
  walkPart(raw, out)

  const html = out.html ? inlineCidImages(out.html, out.attachments) : null
  const hdr = (name: string) => decodeEncodedWords(headers.get(name) ?? '')

  return {
    subject: hdr('subject'),
    from: hdr('from'),
    to: hdr('to'),
    cc: hdr('cc'),
    date: headers.get('date') ?? '',
    html,
    text: out.text,
    // Inline images already live in the body; don't also list them as downloads.
    attachments: out.attachments.filter(a => !a.inline),
  }
}
