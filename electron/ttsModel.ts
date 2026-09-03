import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { MAX_REDIRECTS, assertPublicHttpUrl, pinnedRequest, type PinnedResponse } from './security'

/**
 * Acquiring the Supertonic 3 weights.
 *
 * The weights are **not** shipped in the installer. They are 383 MB against an
 * installer that is currently 246 MB, and text-to-speech is an opt-in feature —
 * bundling would make every user pay 2.5x the download for something most of
 * them never open. They are fetched once, on first use, into userData.
 *
 * This does not weaken the app's privacy promise: that promise is about
 * *documents*, and no document is involved here. Once the weights are on disk
 * every synthesis runs locally, offline, forever.
 *
 * Licence note: the weights are OpenRAIL-M, not MIT like the rest of the app —
 * see electron/vendor/supertonic/README.md and THIRD_PARTY_NOTICES.md. The
 * consent step in the renderer exists partly for that reason.
 */

/** Only this origin is ever contacted, on top of the shared public-URL vetting. */
const MODEL_ORIGIN = 'https://huggingface.co'
const MODEL_REPO = 'Supertone/supertonic-3'
// A commit, not a branch: `main` can be moved, and these bytes are fed to a
// native ONNX parser. The per-file `oid` below is the git blob id at this
// commit (sha1 over "blob <size>\0" + bytes), which Hugging Face publishes for
// non-LFS files — so every download is checked against a hash the repository
// itself cannot change without changing the commit.
const MODEL_REVISION = '3cadd1ee6394adea1bd021217a0e650ede09a323'

/**
 * Every file, with the exact size upstream serves.
 *
 * The size is the integrity check. It is not a hash — Hugging Face serves these
 * over TLS from a pinned origin, and a truncated download (the realistic
 * failure, not a tampered one) is exactly what a size check catches. Anything
 * that does not match is deleted rather than kept, because a half-written ONNX
 * file fails later with a parse error that looks like a bug in our code.
 */
export const MODEL_FILES: readonly { path: string; bytes: number; oid: string }[] = [
  { path: 'onnx/duration_predictor.onnx', bytes: 3700147, oid: '3dc0f3ca70185b0ecb20ee812832fa8fd87d5f77' },
  { path: 'onnx/text_encoder.onnx', bytes: 36416150, oid: '001b50875741258a8681a472d63929b2e18abe55' },
  { path: 'onnx/tts.json', bytes: 8253, oid: '28575b0793c92607a0f0a292550df9bd17709a79' },
  { path: 'onnx/unicode_indexer.json', bytes: 277676, oid: '3aaf4d33024aff0be455633c24b3636b3a810150' },
  { path: 'onnx/vector_estimator.onnx', bytes: 256534781, oid: 'e5e45d221db3825dc28fe20039cfca7e329cfd18' },
  { path: 'onnx/vocoder.onnx', bytes: 101424195, oid: 'b50be323eb0a124468b665e0e3e8380710090744' },
  { path: 'voice_styles/F1.json', bytes: 292046, oid: '421365f307ed1535d8da16845031d0e9fa3e60c5' },
  { path: 'voice_styles/F2.json', bytes: 292423, oid: 'b09a3a433df8a4856d1d7d64736a56ddf37a4ea3' },
  { path: 'voice_styles/F3.json', bytes: 290794, oid: 'a366f94c77c4b440404071f1a52bed3ccf83a5ff' },
  { path: 'voice_styles/F4.json', bytes: 291808, oid: '39c78a52795320c6101b7eaf984c0e2352fbdc18' },
  { path: 'voice_styles/F5.json', bytes: 291479, oid: '06983f8816ad00a8eeb7efd37a33d457587e16f8' },
  { path: 'voice_styles/M1.json', bytes: 291748, oid: 'bddfff85a7c4c140c11620bd7005d86681dccdac' },
  { path: 'voice_styles/M2.json', bytes: 292055, oid: '602ff6c4d6d48cdb71c37461f7c175d71fe8b34b' },
  { path: 'voice_styles/M3.json', bytes: 290198, oid: '000b60436b77619b933fdc33628ad737595e6794' },
  { path: 'voice_styles/M4.json', bytes: 291522, oid: 'aae253ae81185fa06a6469c3f1cdff04ed121ddf' },
  { path: 'voice_styles/M5.json', bytes: 291469, oid: '0536b252698830f8536c077edcb94e1ce4768ab6' },
]

export const MODEL_TOTAL_BYTES = MODEL_FILES.reduce((sum, f) => sum + f.bytes, 0)

/** The voices offered in the UI, in the order they are shown. */
export const VOICE_IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'] as const
export type VoiceId = typeof VOICE_IDS[number]

export function isVoiceId(value: unknown): value is VoiceId {
  return typeof value === 'string' && (VOICE_IDS as readonly string[]).includes(value)
}

export function modelDir(): string {
  return path.join(app.getPath('userData'), 'tts', 'supertonic-3')
}

function localPath(rel: string): string {
  return path.join(modelDir(), ...rel.split('/'))
}

function isComplete(rel: string, bytes: number): boolean {
  try {
    return fs.statSync(localPath(rel)).size === bytes
  } catch {
    return false
  }
}

export interface ModelStatus {
  /** Every file present at its exact size. */
  ready: boolean
  bytesPresent: number
  bytesTotal: number
  dir: string
}

export function modelStatus(): ModelStatus {
  let bytesPresent = 0
  let ready = true
  for (const file of MODEL_FILES) {
    if (isComplete(file.path, file.bytes)) bytesPresent += file.bytes
    else ready = false
  }
  return { ready, bytesPresent, bytesTotal: MODEL_TOTAL_BYTES, dir: modelDir() }
}

export interface DownloadProgress {
  bytesReceived: number
  bytesTotal: number
  /** The file currently being fetched, for a more informative message. */
  file: string
}

/**
 * Fetch one file to `<dest>.part`, then rename.
 *
 * Downloading straight onto the final name would leave a truncated file behind
 * on a dropped connection, and the size check would then reject it on every
 * later run without ever explaining why. The temporary name means an
 * interrupted download simply is not there next time.
 */
async function fetchFile(
  rel: string,
  bytes: number,
  oid: string,
  signal: AbortSignal,
  onChunk: (n: number) => void,
): Promise<void> {
  const target = localPath(rel)
  const part = target + '.part'
  await fs.promises.mkdir(path.dirname(target), { recursive: true })

  let pinned = await assertPublicHttpUrl(
    `${MODEL_ORIGIN}/${MODEL_REPO}/resolve/${MODEL_REVISION}/${rel}`)
  let response: PinnedResponse | null = null
  // Hugging Face redirects model blobs to a CDN, so redirects must be followed
  // — but each hop is re-vetted and re-pinned, never trusted because the first
  // one was, and none may drop to plain http.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    response = await pinnedRequest(pinned, signal)
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.location
    response.body.resume()
    if (!location || hop === MAX_REDIRECTS) throw new Error(`Too many redirects for ${rel}`)
    pinned = await assertPublicHttpUrl(new URL(location, pinned.url).href)
    if (pinned.url.protocol !== 'https:') throw new Error(`Insecure redirect for ${rel}`)
  }
  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error(`Download failed for ${rel} (HTTP ${response?.status ?? 0})`)
  }

  let written = 0
  // Git's blob hash covers the size prefix, so a same-length substitution
  // still fails the check.
  const hash = createHash('sha1')
  hash.update(`blob ${bytes}\0`)
  const out = fs.createWriteStream(part)
  try {
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      written += chunk.length
      hash.update(chunk)
      // Stop a runaway response rather than filling the user's disk.
      if (written > bytes) throw new Error(`${rel} is larger than expected`)
      if (!out.write(chunk)) await new Promise<void>(resolve => out.once('drain', () => resolve()))
      onChunk(chunk.length)
    }
  } finally {
    await new Promise<void>(resolve => out.end(resolve))
  }

  if (written !== bytes) {
    await fs.promises.rm(part, { force: true })
    throw new Error(`${rel} downloaded ${written} bytes, expected ${bytes}`)
  }
  if (hash.digest('hex') !== oid) {
    await fs.promises.rm(part, { force: true })
    throw new Error(`${rel} does not match the published checksum`)
  }
  await fs.promises.rename(part, target)
}

/**
 * Download whatever is missing. Resumable in the sense that matters: files
 * already complete are skipped, so an interrupted run continues where it
 * stopped rather than starting the 383 MB again.
 */
export async function downloadModel(
  signal: AbortSignal,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  const missing = MODEL_FILES.filter(f => !isComplete(f.path, f.bytes))
  let received = MODEL_TOTAL_BYTES - missing.reduce((sum, f) => sum + f.bytes, 0)

  for (const file of missing) {
    if (signal.aborted) throw new Error('Download cancelled')
    onProgress({ bytesReceived: received, bytesTotal: MODEL_TOTAL_BYTES, file: file.path })
    let sinceReport = 0
    await fetchFile(file.path, file.bytes, file.oid, signal, n => {
      received += n
      sinceReport += n
      // Reporting every chunk would flood the IPC channel on a fast link.
      if (sinceReport >= 1024 * 1024) {
        sinceReport = 0
        onProgress({ bytesReceived: received, bytesTotal: MODEL_TOTAL_BYTES, file: file.path })
      }
    })
  }
  onProgress({ bytesReceived: MODEL_TOTAL_BYTES, bytesTotal: MODEL_TOTAL_BYTES, file: '' })
}
