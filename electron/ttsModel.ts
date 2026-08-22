import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { MAX_REDIRECTS, assertPublicHttpUrl } from './security'

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
const MODEL_REVISION = 'main'

/**
 * Every file, with the exact size upstream serves.
 *
 * The size is the integrity check. It is not a hash — Hugging Face serves these
 * over TLS from a pinned origin, and a truncated download (the realistic
 * failure, not a tampered one) is exactly what a size check catches. Anything
 * that does not match is deleted rather than kept, because a half-written ONNX
 * file fails later with a parse error that looks like a bug in our code.
 */
export const MODEL_FILES: readonly { path: string; bytes: number }[] = [
  { path: 'onnx/duration_predictor.onnx', bytes: 3700147 },
  { path: 'onnx/text_encoder.onnx', bytes: 36416150 },
  { path: 'onnx/tts.json', bytes: 8253 },
  { path: 'onnx/unicode_indexer.json', bytes: 277676 },
  { path: 'onnx/vector_estimator.onnx', bytes: 256534781 },
  { path: 'onnx/vocoder.onnx', bytes: 101424195 },
  { path: 'voice_styles/F1.json', bytes: 292046 },
  { path: 'voice_styles/F2.json', bytes: 292423 },
  { path: 'voice_styles/F3.json', bytes: 290794 },
  { path: 'voice_styles/F4.json', bytes: 291808 },
  { path: 'voice_styles/F5.json', bytes: 291479 },
  { path: 'voice_styles/M1.json', bytes: 291748 },
  { path: 'voice_styles/M2.json', bytes: 292055 },
  { path: 'voice_styles/M3.json', bytes: 290198 },
  { path: 'voice_styles/M4.json', bytes: 291522 },
  { path: 'voice_styles/M5.json', bytes: 291469 },
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
  signal: AbortSignal,
  onChunk: (n: number) => void,
): Promise<void> {
  const target = localPath(rel)
  const part = target + '.part'
  await fs.promises.mkdir(path.dirname(target), { recursive: true })

  let url = await assertPublicHttpUrl(
    `${MODEL_ORIGIN}/${MODEL_REPO}/resolve/${MODEL_REVISION}/${rel}`)
  let response: Response | null = null
  // Hugging Face redirects model blobs to a CDN, so redirects must be followed
  // — but each hop is re-vetted, never trusted because the first one was.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    response = await fetch(url.href, { redirect: 'manual', signal })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location || hop === MAX_REDIRECTS) throw new Error(`Too many redirects for ${rel}`)
    url = await assertPublicHttpUrl(new URL(location, url).href)
  }
  if (!response || !response.ok || !response.body) {
    throw new Error(`Download failed for ${rel} (HTTP ${response?.status ?? 0})`)
  }

  let written = 0
  const out = fs.createWriteStream(part)
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      written += chunk.length
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
    await fetchFile(file.path, file.bytes, signal, n => {
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
