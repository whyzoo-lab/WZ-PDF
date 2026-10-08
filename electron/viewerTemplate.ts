/**
 * The portable exe that "Viewer EXE" exports are made from — fetched when it
 * is first needed instead of shipped inside the installer.
 *
 * A viewer exe is the portable build with a PDF appended, so the installed app
 * needs a copy of the portable to start from. It used to carry one, bundled as
 * resources/viewer-template.exe: ~136 MB of a ~289 MB installer, for a feature
 * most installs never use — and, changing with every release, it also made
 * every automatic update download it again. The installer now carries only
 * viewer-template.json (written by scripts/afterPack.cjs): the portable's file
 * name, size and SHA-512, taken from the very file the release uploads.
 *
 * On first use the portable is downloaded from this version's GitHub release —
 * or, on a machine without internet, picked from disk — and kept in userData
 * only if it matches that size and hash exactly. The hash comes from the
 * installed app, not from the network, so a tampered download cannot pass.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { MAX_REDIRECTS, assertPublicHttpUrl, pinnedRequest, type PinnedResponse } from './security'

/** Thrown when what arrived is not this version's portable (size or hash). */
export class TemplateMismatchError extends Error {
  constructor() { super('the download does not match this version') }
}

/** Where releases are published (electron-builder.json5 "publish"). */
export const RELEASE_BASE = 'https://github.com/whyzoo-lab/WZ-PDF/releases/download'

export interface TemplateManifest {
  version: string
  /** The portable's release asset name, e.g. WZ_Reader_1.25.0.exe (WZ_PDF_… before 1.25.0). */
  file: string
  size: number
  /** Base64 SHA-512 of the whole file. */
  sha512: string
}

/** Validate viewer-template.json. Anything odd means "no manifest". */
export function parseManifest(raw: string, appVersion: string): TemplateManifest | null {
  try {
    const m = JSON.parse(raw) as Partial<TemplateManifest>
    if (m.version !== appVersion) return null
    if (typeof m.file !== 'string' || !/^WZ_(?:Reader|PDF)_[0-9][0-9A-Za-z.-]*\.exe$/.test(m.file)) return null
    if (typeof m.size !== 'number' || !Number.isSafeInteger(m.size) || m.size <= 0) return null
    if (typeof m.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(m.sha512)) return null
    return { version: m.version, file: m.file, size: m.size, sha512: m.sha512 }
  } catch {
    return null
  }
}

/** The release download URL for a manifest. */
export function templateUrl(m: TemplateManifest): string {
  return `${RELEASE_BASE}/v${encodeURIComponent(m.version)}/${encodeURIComponent(m.file)}`
}

/** Where a verified copy is kept. */
export function cachedTemplatePath(userData: string, m: TemplateManifest): string {
  return path.join(userData, 'viewer-template', m.file)
}

export async function readManifest(resourcesPath: string, appVersion: string): Promise<TemplateManifest | null> {
  try {
    return parseManifest(await fs.promises.readFile(path.join(resourcesPath, 'viewer-template.json'), 'utf8'), appVersion)
  } catch {
    return null
  }
}

/** A verified copy already on disk (size checked; the hash was checked when it was stored). */
export async function cachedTemplate(userData: string, m: TemplateManifest): Promise<string | null> {
  const file = cachedTemplatePath(userData, m)
  try {
    return (await fs.promises.stat(file)).size === m.size ? file : null
  } catch {
    return null
  }
}

async function sha512OfFile(file: string): Promise<string> {
  const hash = createHash('sha512')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('base64')
}

/**
 * Download this version's portable into the cache. Written to `<file>.part` and
 * renamed only once size and hash match, so an interrupted or tampered
 * download leaves nothing behind.
 */
export async function downloadTemplate(
  userData: string,
  m: TemplateManifest,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const target = cachedTemplatePath(userData, m)
  const part = `${target}.part`
  await fs.promises.mkdir(path.dirname(target), { recursive: true })

  let pinned = await assertPublicHttpUrl(templateUrl(m))
  let response: PinnedResponse | null = null
  // GitHub answers a release asset with a redirect to its storage host; each
  // hop is re-vetted and re-pinned, and none may drop to plain http.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    response = await pinnedRequest(pinned, signal)
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.location
    response.body.resume()
    if (!location || hop === MAX_REDIRECTS) throw new Error('Too many redirects')
    pinned = await assertPublicHttpUrl(new URL(location, pinned.url).href)
    if (pinned.url.protocol !== 'https:') throw new Error('Insecure redirect')
  }
  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response?.status ?? 0}`)
  }

  const hash = createHash('sha512')
  let written = 0
  const out = fs.createWriteStream(part)
  try {
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      written += chunk.length
      if (written > m.size) throw new TemplateMismatchError()
      hash.update(chunk)
      if (!out.write(chunk)) await new Promise<void>(resolve => out.once('drain', () => resolve()))
      onProgress(written / m.size)
    }
  } catch (err) {
    await new Promise<void>(resolve => out.end(resolve))
    await fs.promises.rm(part, { force: true })
    throw err
  }
  await new Promise<void>(resolve => out.end(resolve))
  if (written !== m.size || hash.digest('base64') !== m.sha512) {
    await fs.promises.rm(part, { force: true })
    throw new TemplateMismatchError()
  }
  await fs.promises.rename(part, target)
  return target
}

/**
 * Use a portable the reader picked (a machine without internet). Accepted only
 * if it is byte-for-byte this version's portable; then copied into the cache.
 */
export async function adoptTemplate(userData: string, m: TemplateManifest, picked: string): Promise<string> {
  const stat = await fs.promises.stat(picked)
  if (stat.size !== m.size || (await sha512OfFile(picked)) !== m.sha512) {
    throw new Error(`not ${m.file}`)
  }
  const target = cachedTemplatePath(userData, m)
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  await fs.promises.copyFile(picked, `${target}.part`)
  await fs.promises.rename(`${target}.part`, target)
  return target
}

/** Drop copies kept for other versions — they can never be used again. */
export async function pruneOtherVersions(userData: string, m: TemplateManifest): Promise<void> {
  const dir = path.join(userData, 'viewer-template')
  try {
    for (const name of await fs.promises.readdir(dir)) {
      if (name !== m.file) await fs.promises.rm(path.join(dir, name), { force: true })
    }
  } catch { /* nothing kept yet */ }
}
