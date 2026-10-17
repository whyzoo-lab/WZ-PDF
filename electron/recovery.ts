// Autosave and crash recovery: the store in userData/recovery.
//
// While a document has unsaved changes the renderer hands its state here every
// so often — the document's bytes (written once per version of the file) and a
// small JSON record with the lasting annotations or the Markdown being edited.
// Saving, discarding or a normal quit removes the entry; what is left at the
// next start is a crash's, and the app offers to bring it back.
//
// The approach follows PdfCraft's recovery store (crates/ui-egui/src/recovery.rs,
// Apache-2.0/MIT): bytes before metadata and both written atomically, so a
// listed entry always has complete bytes; and each entry names the process that
// wrote it, so a second running copy of the app neither offers nor deletes the
// first copy's live autosaves. PdfCraft holds a locked file for that; Node has
// no file locks, so the writer's pid is checked for being alive instead.

import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'

/** What the renderer sends with each autosave. */
export interface RecoveryRecord {
  key: string
  /** File name shown in the prompt and given to the reopened document. */
  name: string
  /** Where it was opened from, when it came from disk (recents, the folder of a picture). */
  path?: string
  /** The bytes differ from the file on disk (pages were edited): reopened as unsaved. */
  modified: boolean
  /** Lasting annotations, as the renderer keeps them (stamps, signatures, text edits…). */
  annotations: unknown[]
  /** Markdown being edited, when that is what is unsaved. */
  markdownText?: string
}

export interface RecoveryEntry extends RecoveryRecord {
  savedAt: number
  pid: number
  hasBody: boolean
}

/** What the start-up prompt lists — no document content. */
export interface RecoverySummary {
  key: string
  name: string
  path?: string
  savedAt: number
}

const KEY = /^[a-z0-9-]{8,64}$/
/** One recovery record's JSON (annotations carry stamp images as data URLs). */
const MAX_RECORD_BYTES = 64 * 1024 * 1024
/** The document itself; anything bigger is not autosaved. */
export const MAX_BODY_BYTES = 200 * 1024 * 1024

export function isRecoveryKey(key: unknown): key is string {
  return typeof key === 'string' && KEY.test(key)
}

/** Shape-check a record from the renderer (the IPC boundary). */
export function isRecoveryRecord(r: unknown): r is RecoveryRecord {
  if (!r || typeof r !== 'object') return false
  const o = r as Record<string, unknown>
  return isRecoveryKey(o.key)
    && typeof o.name === 'string' && o.name.length > 0 && o.name.length < 1024 && !/[\\/\0]/.test(o.name)
    && (o.path === undefined || (typeof o.path === 'string' && o.path.length < 4096 && path.isAbsolute(o.path)))
    && typeof o.modified === 'boolean'
    && Array.isArray(o.annotations)
    && (o.markdownText === undefined || typeof o.markdownText === 'string')
}

/** Whether a process with this pid is running (a crash leaves none). */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: it exists, it is just not ours to signal.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Write `data` to `file` through a temporary file beside it, then rename over it. */
export async function writeAtomically(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  const handle = await fs.promises.open(tmp, 'wx')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.promises.rename(tmp, file)
  } catch (err) {
    await fs.promises.rm(tmp, { force: true })
    throw err
  }
}

export class RecoveryStore {
  private readonly dir: string
  private readonly pid: number
  private readonly alive: (pid: number) => boolean

  constructor(dir: string, pid = process.pid, alive = isAlive) {
    this.dir = dir
    this.pid = pid
    this.alive = alive
  }

  private file(key: string, ext: 'json' | 'bin'): string {
    if (!isRecoveryKey(key)) throw new Error('Invalid recovery key')
    return path.join(this.dir, `${key}.${ext}`)
  }

  /**
   * Write (or replace) an entry. `body` is the document's bytes; null keeps the
   * bytes already written for this key (only the annotations changed).
   */
  async write(record: RecoveryRecord, body: Uint8Array | null): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true })
    const bodyFile = this.file(record.key, 'bin')
    if (body) {
      if (body.byteLength > MAX_BODY_BYTES) throw new Error('Document too large to autosave')
      await writeAtomically(bodyFile, body)
    }
    const entry: RecoveryEntry = {
      ...record, savedAt: Date.now(), pid: this.pid,
      hasBody: !!body || fs.existsSync(bodyFile),
    }
    const json = JSON.stringify(entry)
    if (json.length > MAX_RECORD_BYTES) throw new Error('Recovery record too large')
    await writeAtomically(this.file(record.key, 'json'), json)
  }

  async remove(key: string): Promise<void> {
    await fs.promises.rm(this.file(key, 'json'), { force: true })
    await fs.promises.rm(this.file(key, 'bin'), { force: true })
  }

  private async entries(): Promise<RecoveryEntry[]> {
    let names: string[]
    try { names = await fs.promises.readdir(this.dir) } catch { return [] }
    const out: RecoveryEntry[] = []
    for (const name of names) {
      const m = /^([a-z0-9-]+)\.json$/.exec(name)
      if (!m || !isRecoveryKey(m[1])) continue
      try {
        const entry = JSON.parse(await fs.promises.readFile(path.join(this.dir, name), 'utf8')) as RecoveryEntry
        if (!isRecoveryRecord(entry) || entry.key !== m[1] || typeof entry.savedAt !== 'number' || typeof entry.pid !== 'number') continue
        out.push(entry)
      } catch { /* damaged: not offered */ }
    }
    return out
  }

  /**
   * What a previous session left: entries written by a process that is no
   * longer running, newest first. This process's own entries and those of
   * another running copy are left out.
   */
  async list(): Promise<RecoverySummary[]> {
    return (await this.entries())
      .filter(e => e.pid !== this.pid && !this.alive(e.pid))
      .sort((a, b) => b.savedAt - a.savedAt)
      .map(({ key, name, path: p, savedAt }) => ({ key, name, path: p, savedAt }))
  }

  /** One entry with its bytes, to reopen it. */
  async read(key: string): Promise<{ entry: RecoveryEntry; body: Uint8Array | null } | null> {
    try {
      const entry = JSON.parse(await fs.promises.readFile(this.file(key, 'json'), 'utf8')) as RecoveryEntry
      if (!isRecoveryRecord(entry) || entry.key !== key) return null
      const body = entry.hasBody ? new Uint8Array(await fs.promises.readFile(this.file(key, 'bin'))) : null
      return { entry, body }
    } catch {
      return null
    }
  }

  /** Remove this process's entries — a normal quit leaves nothing to recover. */
  async removeOwn(): Promise<void> {
    for (const e of await this.entries()) if (e.pid === this.pid) await this.remove(e.key)
  }

  /** Remove what previous sessions left ("Discard all"). Live copies keep theirs. */
  async discardLeftovers(): Promise<void> {
    for (const e of await this.list()) await this.remove(e.key)
  }

  /** Synchronous variant of removeOwn, for the last moment of a quit. */
  removeOwnSync(): void {
    let names: string[]
    try { names = fs.readdirSync(this.dir) } catch { return }
    for (const name of names) {
      const m = /^([a-z0-9-]+)\.json$/.exec(name)
      if (!m || !isRecoveryKey(m[1])) continue
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8')) as RecoveryEntry
        if (entry.pid !== this.pid) continue
        fs.rmSync(path.join(this.dir, name), { force: true })
        fs.rmSync(path.join(this.dir, `${m[1]}.bin`), { force: true })
      } catch { /* leave it */ }
    }
  }
}
