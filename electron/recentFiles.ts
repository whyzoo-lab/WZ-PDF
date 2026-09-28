import fs from 'fs'
import path from 'path'
import { isAllowedDocumentPath } from './security'

/** How many recent documents the start screen lists. */
export const RECENT_LIMIT = 8

export interface RecentFile {
  path: string
  /** When it was last opened, ms since the epoch. */
  openedAt: number
}

/**
 * Put `filePath` at the front of the list, once.
 *
 * Only absolute paths to a format the app opens are kept — the renderer is the
 * threat model for IPC, and nothing in this list is ever read without going
 * back through `read-file`'s full validation anyway. Windows paths compare
 * case-insensitively, so `C:\A.pdf` and `c:\a.PDF` are one entry.
 */
export function addRecent(list: readonly RecentFile[], filePath: string, now = Date.now()): RecentFile[] {
  if (!isRecentCandidate(filePath)) return [...list]
  const key = sameFileKey(filePath)
  return [{ path: filePath, openedAt: now }, ...list.filter(r => sameFileKey(r.path) !== key)].slice(0, RECENT_LIMIT)
}

export function removeRecent(list: readonly RecentFile[], filePath: string): RecentFile[] {
  const key = sameFileKey(String(filePath))
  return list.filter(r => sameFileKey(r.path) !== key)
}

export function isRecentCandidate(filePath: unknown): filePath is string {
  return typeof filePath === 'string'
    && filePath.length > 0 && filePath.length < 4096
    && !filePath.includes('\0')
    && path.isAbsolute(filePath)
    && isAllowedDocumentPath(filePath.toLowerCase())
}

function sameFileKey(p: string): string {
  return process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p)
}

/** Parse the stored list, dropping anything malformed rather than failing. */
export function parseRecent(raw: string): RecentFile[] {
  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data
      .filter((r): r is RecentFile => !!r && typeof r === 'object'
        && isRecentCandidate((r as RecentFile).path) && typeof (r as RecentFile).openedAt === 'number')
      .slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}

/**
 * The list on disk, in the app's own userData folder — paths and times only,
 * never anything from inside a document. Written whole each time; it is eight
 * lines.
 */
export class RecentFilesStore {
  private readonly file: string
  constructor(file: string) { this.file = file }

  async list(): Promise<RecentFile[]> {
    try {
      return parseRecent(await fs.promises.readFile(this.file, 'utf8'))
    } catch {
      return []
    }
  }

  async add(filePath: string): Promise<RecentFile[]> {
    return this.write(addRecent(await this.list(), filePath))
  }

  async remove(filePath: string): Promise<RecentFile[]> {
    return this.write(removeRecent(await this.list(), filePath))
  }

  async clear(): Promise<RecentFile[]> {
    return this.write([])
  }

  private async write(list: RecentFile[]): Promise<RecentFile[]> {
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true })
    await fs.promises.writeFile(this.file, JSON.stringify(list), 'utf8')
    return list
  }
}
