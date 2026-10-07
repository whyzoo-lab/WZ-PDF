import path from 'path'
import { randomUUID } from 'crypto'

/**
 * Saving a narrated video (src/services/slideVideo.ts): the reader names the
 * .mp4 in the native save dialog, and the rest of the set is written beside it
 * under the same name — the captioned copy, the .srt and the .vtt — so a
 * player that looks for `name.srt` next to `name.mp4` finds it.
 *
 * It replaced the web folder picker (`showDirectoryPicker`), which asked for a
 * folder rather than a name and failed with "File picker already active" when
 * the button was pressed again while it was open.
 *
 * The renderer never handles a path: `video:pick` keeps the chosen one here
 * and hands back a one-use token, and `video:write` writes only the set
 * derived from it. A compromised renderer could otherwise name any file.
 */

/** The four files of a set, from the .mp4 the reader chose. */
export function videoSetPaths(mp4Path: string, captionedSuffix: string) {
  const dir = path.dirname(mp4Path)
  const stem = path.basename(mp4Path).replace(/\.mp4$/i, '')
  return {
    plain: path.join(dir, `${stem}.mp4`),
    captioned: path.join(dir, `${stem} (${captionedSuffix}).mp4`),
    srt: path.join(dir, `${stem}.srt`),
    vtt: path.join(dir, `${stem}.vtt`),
  }
}

/** Characters Windows does not allow in a file name. */
const UNSAFE = /[<>:"/\\|?*]/g

/**
 * A file-name part with the forbidden characters and control characters
 * removed. Control characters are dropped by code point rather than in the
 * regex, which would need a lint exception that the compiled .js then reports
 * as unused.
 */
function safeName(value: string): string {
  return [...value.replace(UNSAFE, '')].filter(ch => (ch.codePointAt(0) ?? 0) >= 0x20).join('')
}

/** A label that becomes part of a file name: no path in it, kept short. */
export function cleanSuffix(value: unknown): string {
  const s = typeof value === 'string' ? safeName(value).trim().slice(0, 40) : ''
  return s || 'captioned'
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
const MAX_TEXT_CHARS = 20 * 1024 * 1024

export interface VideoFiles {
  plain: Uint8Array
  captioned: Uint8Array
  srt: string
  vtt: string
  captionedSuffix: string
}

const isMp4 = (b: unknown): b is Uint8Array =>
  b instanceof Uint8Array && b.byteLength > 12 && b.byteLength <= MAX_VIDEO_BYTES
  && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 // 'ftyp'

/** Throws unless `value` is a set of files this feature makes. */
export function validateVideoFiles(value: unknown): VideoFiles {
  const v = value as Partial<VideoFiles> | null
  if (!v || typeof v !== 'object') throw new Error('Invalid video files')
  if (!isMp4(v.plain) || !isMp4(v.captioned)) throw new Error('Invalid MP4 data')
  if (typeof v.srt !== 'string' || typeof v.vtt !== 'string'
    || v.srt.length > MAX_TEXT_CHARS || v.vtt.length > MAX_TEXT_CHARS) throw new Error('Invalid captions')
  return { plain: v.plain, captioned: v.captioned, srt: v.srt, vtt: v.vtt, captionedSuffix: cleanSuffix(v.captionedSuffix) }
}
