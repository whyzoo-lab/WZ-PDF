import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import path from 'node:path'
import type { Readable } from 'node:stream'

export const MAX_DOCUMENT_BYTES = 500 * 1024 * 1024
export const MAX_URL_LENGTH = 2_048
export const MAX_REDIRECTS = 5
export const FETCH_TIMEOUT_MS = 30_000

/** Parse an external URL without relying on bypassable string-prefix checks. */
export function parseHttpUrl(rawUrl: unknown): URL {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_URL_LENGTH) {
    throw new Error('Invalid URL')
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Malformed URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed')
  }
  if (url.username || url.password) {
    throw new Error('URLs containing credentials are not allowed')
  }
  return url
}

/** Only the packaged app origin and the exact Vite development origin are trusted. */
export function isTrustedRendererUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.username || url.password) return false
    if (url.protocol === 'app:') return url.hostname === 'bundle' && url.port === ''
    return url.protocol === 'http:' && url.hostname === 'localhost' && url.port === '5173'
  } catch {
    return false
  }
}

/** Resolve an app://bundle URL to a file strictly contained by distDir. */
export function resolveAppAssetPath(distDir: string, rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'app:' || url.hostname !== 'bundle') return null

  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  if (pathname.includes('\0')) return null
  if (pathname === '/' || pathname === '') pathname = '/index.html'

  // Treat both slash styles as separators. This matters on Windows where an
  // encoded backslash could otherwise bypass a check written for URL slashes.
  const relativeRequest = pathname.replace(/[\\/]+/g, path.sep).replace(/^[/\\]+/, '')
  const root = path.resolve(distDir)
  const candidate = path.resolve(root, relativeRequest)
  const relative = path.relative(root, candidate)
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null
  }
  return candidate
}

/** True for loopback, private, link-local, documentation, and other non-public IPs. */
export function isNonPublicIp(address: string): boolean {
  const normalized = address.toLowerCase().split('%', 1)[0]
  const family = isIP(normalized)
  if (family === 4) {
    const [a, b, c] = normalized.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    )
  }
  if (family === 6) {
    if (normalized.startsWith('::ffff:')) return true
    const first = Number.parseInt(normalized.split(':', 1)[0] || '0', 16)
    return (
      normalized === '::' ||
      normalized === '::1' ||
      first < 0x2000 ||
      first > 0x3fff ||
      normalized.startsWith('2001:db8:') ||
      normalized === '2001:db8::'
    )
  }
  return true
}

/** A URL together with the one address it was vetted at. */
export interface PinnedTarget {
  url: URL
  /** The IP the request must connect to — never re-resolve the hostname. */
  address: string
  family: 4 | 6
}

/**
 * Resolve a URL host and reject targets that can reach the local machine or
 * LAN. Returns the address that passed, and the caller must connect to *that*
 * — resolving the name a second time at connect time is the DNS-rebinding
 * hole: an attacker's resolver answers a public IP for this check and
 * 127.0.0.1 for the connection that follows.
 */
export async function assertPublicHttpUrl(rawUrl: unknown): Promise<PinnedTarget> {
  const url = parseHttpUrl(rawUrl)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const literalFamily = isIP(hostname)
  const addresses = literalFamily
    ? [hostname]
    : (await lookup(hostname, { all: true, verbatim: true })).map(result => result.address)

  if (addresses.length === 0 || addresses.some(isNonPublicIp)) {
    throw new Error('Local and private network URLs are not allowed')
  }
  const address = addresses[0]
  return { url, address, family: isIP(address) === 6 ? 6 : 4 }
}

export interface PinnedResponse {
  status: number
  headers: http.IncomingHttpHeaders
  body: Readable
}

/**
 * One request to a vetted target, connected to the vetted address.
 *
 * `fetch()` cannot be told which address to use, so this goes through
 * `http(s).request` with a `lookup` that hands back the pinned address. TLS
 * still validates against the hostname (`servername`), and the Host header is
 * the hostname, so nothing about the request changes except that the socket
 * goes where the check looked. Redirects are the caller's: each hop must be
 * vetted and pinned again.
 */
export function pinnedRequest(target: PinnedTarget, signal: AbortSignal): Promise<PinnedResponse> {
  const { url, address, family } = target
  const client = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    // An explicit options object: under a foreign `URL` (jsdom, another realm)
    // `request(url, …)` treats the URL as options and drops its path.
    const req = client.request({
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      signal,
      servername: url.protocol === 'https:' && !isIP(url.hostname) ? url.hostname : undefined,
      // Node's connector asks with `all: true` (happy-eyeballs) and then
      // expects an array of {address, family}; older paths ask for one.
      lookup: (_host, opts, cb) => {
        const one = { address, family }
        ;(cb as (e: Error | null, a: unknown, f?: number) => void)(
          null, (opts as { all?: boolean } | undefined)?.all ? [one] : address, family)
      },
      headers: { 'user-agent': 'WZ-PDF' },
    }, res => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }))
    req.on('error', reject)
    req.end()
  })
}

export function isTrustedUpdateUrl(rawUrl: unknown, trustedOrigin: string): boolean {
  try {
    const url = parseHttpUrl(rawUrl)
    return url.origin === trustedOrigin && url.protocol === 'https:'
  } catch {
    return false
  }
}

// ── What the desktop app may open from disk ────────────────────────────────
//
// One list, because three places used to carry their own copy and drifted: the
// installer's file associations, the argv scan that handles a double-clicked
// file, and the read-file IPC. Markdown was in none of them, so associating
// .md by hand opened the app to an empty window.

/** Formats whose first bytes identify them, so a renamed file can be caught. */
const BINARY_DOCUMENT_EXTENSIONS = [
  'pdf', 'hwp', 'hwpx', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp',
] as const

/**
 * Formats that are plain text and therefore have no signature to check.
 *
 * Accepting these on the extension alone is not a hole in the signature check.
 * `read-file`'s threat model is a compromised renderer asking the main process
 * to read an arbitrary path, and that stays bounded by the extension allowlist,
 * the symlink-resolved path and the size cap. The signature exists to stop a
 * renamed binary being handed back as a document, which can only be enforced
 * for formats that have one.
 */
const TEXT_DOCUMENT_EXTENSIONS = ['eml', 'md', 'markdown', 'mdown', 'mkd'] as const

export const DOCUMENT_EXTENSIONS: readonly string[] = [
  ...BINARY_DOCUMENT_EXTENSIONS, ...TEXT_DOCUMENT_EXTENSIONS,
]

function extensionOf(lowerPath: string): string {
  const dot = lowerPath.lastIndexOf('.')
  return dot === -1 ? '' : lowerPath.slice(dot + 1)
}

/** True when the path names a format the app can open. Expects a lower-cased path. */
export function isAllowedDocumentPath(lowerPath: string): boolean {
  return DOCUMENT_EXTENSIONS.includes(extensionOf(lowerPath))
}

/** True for the text formats, which are exempt from the signature check. */
export function isTextDocumentPath(lowerPath: string): boolean {
  return (TEXT_DOCUMENT_EXTENSIONS as readonly string[]).includes(extensionOf(lowerPath))
}

export function hasSupportedDocumentSignature(bytes: Uint8Array): boolean {
  const at = (i: number, ...expected: number[]) => expected.every((b, n) => bytes[i + n] === b)
  return (
    at(0, 0x25, 0x50, 0x44, 0x46) ||                                // %PDF
    at(0, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1) ||        // OLE2 (.hwp)
    at(0, 0x50, 0x4b, 0x03, 0x04) ||                                // ZIP (.hwpx)
    at(0, 0x89, 0x50, 0x4e, 0x47) ||                                // PNG
    at(0, 0xff, 0xd8, 0xff) ||                                      // JPEG
    at(0, 0x47, 0x49, 0x46, 0x38) ||                                // GIF8
    at(0, 0x42, 0x4d) ||                                            // BM
    // RIFF….WEBP — RIFF alone is also .wav/.avi, so the tag at byte 8 matters.
    (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
  )
}
