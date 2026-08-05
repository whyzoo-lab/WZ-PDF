import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import path from 'node:path'

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

/** Resolve a URL host and reject targets that can reach the local machine or LAN. */
export async function assertPublicHttpUrl(rawUrl: unknown): Promise<URL> {
  const url = parseHttpUrl(rawUrl)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const literalFamily = isIP(hostname)
  const addresses = literalFamily
    ? [hostname]
    : (await lookup(hostname, { all: true, verbatim: true })).map(result => result.address)

  if (addresses.length === 0 || addresses.some(isNonPublicIp)) {
    throw new Error('Local and private network URLs are not allowed')
  }
  return url
}

export function isTrustedUpdateUrl(rawUrl: unknown, trustedOrigin: string): boolean {
  try {
    const url = parseHttpUrl(rawUrl)
    return url.origin === trustedOrigin && url.protocol === 'https:'
  } catch {
    return false
  }
}

export function hasSupportedDocumentSignature(bytes: Uint8Array): boolean {
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
  const isHwp = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 && bytes[5] === 0xb1 && bytes[6] === 0x1a && bytes[7] === 0xe1
  const isHwpx = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  return isPdf || isHwp || isHwpx
}
