/**
 * Private mode for the web viewer: the server, not the address bar, decides
 * what can be opened.
 *
 * A deployment turns it on by placing `private.json` next to `app.html`:
 *
 *   {
 *     "documents": {
 *       "rfp":    "docs/RFP-2026.pdf",
 *       "notice": { "url": "/files/get?id=17", "name": "공지.hwp" }
 *     },
 *     "print": false
 *   }
 *
 * and the page embeds `app.html?doc=rfp`. Only those documents open; opening
 * anything else (a file, a drop, `?url=`, a mail attachment), editing and
 * saving are switched off, and printing is off unless `print` is true. URLs
 * are resolved against the config file, so a relative path stays on the same
 * server. With a single document, `?doc` may be left out.
 *
 * It has to be a file on the server: a query-string switch (`?private`) would
 * be one keystroke away from being removed by the person it is meant to limit.
 * The file is read on every start (no cache), so an administrator's change
 * applies to the next page load.
 *
 * What it is not: access control. The browser fetches the document, so whoever
 * can see it can, with the developer tools, keep a copy. Who may see a document
 * at all is the server's job (authentication); this keeps the viewer from
 * being a way to open, change or save anything else.
 */

export const PRIVATE_CONFIG_FILE = 'private.json'

export interface PrivateDocument {
  /** Absolute http(s) URL. */
  url: string
  /** File name, with an extension — Markdown, mail and CSV are told apart by it. */
  name: string
}

export interface PrivateConfig {
  documents: Map<string, PrivateDocument>
  /** Whether printing is allowed. Printing is also "save as PDF", so off by default. */
  print: boolean
}

export type PrivateMode =
  /** Not known yet: everything that opens a document waits. */
  | { status: 'pending' }
  | { status: 'off' }
  | { status: 'on'; config: PrivateConfig }
  /** The server has a config that could not be read: closed, not open. */
  | { status: 'error' }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The last path segment of a URL, decoded; empty when there is none. */
function baseName(url: URL): string {
  const last = url.pathname.split('/').pop() ?? ''
  try { return decodeURIComponent(last) } catch { return last }
}

/**
 * Validates `private.json`. Throws on anything malformed — the caller treats
 * that as "closed", never as "no private mode".
 */
export function parsePrivateConfig(raw: unknown, configUrl: string): PrivateConfig {
  if (!isRecord(raw) || !isRecord(raw.documents)) throw new Error('private.json: "documents" must be an object')
  const documents = new Map<string, PrivateDocument>()
  for (const [id, entry] of Object.entries(raw.documents)) {
    const spec = typeof entry === 'string' ? { url: entry } : entry
    if (!isRecord(spec) || typeof spec.url !== 'string' || !spec.url.trim()) {
      throw new Error(`private.json: document "${id}" has no url`)
    }
    const url = new URL(spec.url.trim(), configUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`private.json: document "${id}" is not an http(s) URL`)
    }
    // Only the last segment of a given name: it names a file, it is not a path.
    const given = typeof spec.name === 'string' ? spec.name.split(/[\\/]/).pop()?.trim() : ''
    documents.set(id, { url: url.href, name: given || baseName(url) || 'document' })
  }
  if (documents.size === 0) throw new Error('private.json: no documents')
  if (raw.print !== undefined && typeof raw.print !== 'boolean') throw new Error('private.json: "print" must be true or false')
  return { documents, print: raw.print === true }
}

/** The document `?doc=` asks for; the only one when it asks for none. */
export function pickPrivateDocument(config: PrivateConfig, docId: string | null): PrivateDocument | null {
  if (docId) return config.documents.get(docId) ?? null
  return config.documents.size === 1 ? [...config.documents.values()][0] : null
}

/**
 * Reads the deployment's `private.json`. Absent means an ordinary viewer: a 404
 * (or the 403 / 410 some static hosts give for a missing file), or an HTML page
 * from a server that answers every path with the app (SPA fallback). Anything
 * else that goes wrong — a server error, a broken file — is `error`, so a
 * deployment that meant to be private never falls open.
 */
export async function loadPrivateMode(base: string, fetchFn: typeof fetch = fetch): Promise<PrivateMode> {
  const configUrl = new URL(PRIVATE_CONFIG_FILE, base)
  // Opened from disk there is no server to have designated anything.
  if (configUrl.protocol !== 'http:' && configUrl.protocol !== 'https:') return { status: 'off' }
  try {
    const res = await fetchFn(configUrl.href, { cache: 'no-store' })
    if (res.status === 404 || res.status === 403 || res.status === 410) return { status: 'off' }
    if (!res.ok) return { status: 'error' }
    const text = await res.text()
    if (text.trimStart().startsWith('<')) return { status: 'off' }
    return { status: 'on', config: parsePrivateConfig(JSON.parse(text), res.url || configUrl.href) }
  } catch (err) {
    console.error('Private mode configuration could not be read:', err)
    return { status: 'error' }
  }
}
