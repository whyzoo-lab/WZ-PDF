import path from 'path'
import { randomUUID } from 'crypto'

/**
 * Saving a narrated video (src/services/slideVideo.ts): one .mp4, named by the
 * reader in the native save dialog, with the subtitles inside it.
 *
 * It replaced the web folder picker (`showDirectoryPicker`), which asked for a
 * folder rather than a name and failed with "File picker already active" when
 * the button was pressed again while it was open.
 *
 * The renderer never handles a path: `video:pick` keeps the chosen one here
 * and hands back a one-use token, and `video:write` writes only there. A
 * compromised renderer could otherwise name any file.
 */

/** Characters Windows does not allow in a file name. */
const UNSAFE = /[<>:"/\\|?*]/g

/**
 * A file name with the forbidden characters and control characters removed.
 * Control characters are dropped by code point rather than in the regex,
 * which would need a lint exception that the compiled .js reports as unused.
 */
function safeName(value: string): string {
  return [...value.replace(UNSAFE, '')].filter(ch => (ch.codePointAt(0) ?? 0) >= 0x20).join('')
}

/** The name offered in the save dialog: a file name only, ending in .mp4. */
export function cleanSuggestedName(value: unknown): string {
  const raw = typeof value === 'string' ? path.basename(value.replace(/\\/g, '/')) : ''
  const stem = safeName(raw).replace(/\.mp4$/i, '').trim().slice(0, 180)
  return `${stem || 'presentation'}.mp4`
}

/** Paths the reader chose, each usable once, for a while. */
export class PendingVideoSaves {
  private readonly saves = new Map<string, { path: string; at: number }>()
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(ttlMs = 6 * 60 * 60 * 1000, now: () => number = () => Date.now()) {
    this.ttlMs = ttlMs
    this.now = now
  }

  add(mp4Path: string): string {
    const token = randomUUID()
    this.saves.set(token, { path: mp4Path, at: this.now() })
    return token
  }

  /** The path for `token`, forgotten as it is returned; undefined if unknown or stale. */
  take(token: unknown): string | undefined {
    if (typeof token !== 'string') return undefined
    const entry = this.saves.get(token)
    this.saves.delete(token)
    for (const [t, e] of this.saves) if (this.now() - e.at > this.ttlMs) this.saves.delete(t)
    if (!entry || this.now() - entry.at > this.ttlMs) return undefined
    return entry.path
  }
}

/** Largest file accepted from the renderer — far beyond any talk. */
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024 - 1

/** Throws unless `value` is an MP4 this feature makes. */
export function validateMp4(value: unknown): Uint8Array {
  const ok = value instanceof Uint8Array && value.byteLength > 12 && value.byteLength <= MAX_VIDEO_BYTES
    && value[4] === 0x66 && value[5] === 0x74 && value[6] === 0x79 && value[7] === 0x70 // 'ftyp'
  if (!ok) throw new Error('Invalid MP4 data')
  return value
}
