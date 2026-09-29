/**
 * "내 도장" — stamps the reader uploaded, and the size each stamp was last
 * given, kept on this computer so a stamp is set up once and then just used.
 *
 * Before this, an uploaded stamp lived only until it was placed: the next page
 * meant uploading the file again and resizing it again (it always landed at
 * 100 x 40, so a round seal came out squashed). Adobe's stamp palette is the
 * model: an uploaded image joins the menu, and it keeps the size it was given.
 *
 * IndexedDB, not localStorage: on the packaged app's app:// origin the first
 * localStorage access blocks the renderer for ~6 s (see CLAUDE.md, "Startup
 * cost"), while IndexedDB opens in tens of milliseconds. It is opened on first
 * use — when the editor is switched on — never at startup. Where IndexedDB is
 * unavailable (a private window) the library still works for the session.
 * Stamp images stay in the app's own storage on this machine; nothing is sent
 * anywhere.
 */

export interface StampSize { width: number; height: number }

export interface SavedStamp extends StampSize {
  id: string
  /** Shown in the menu — the uploaded file's name. */
  name: string
  /** PNG data URL. */
  src: string
  createdAt: number
}

/** Custom stamps are `custom:<id>` wherever a preset id is expected. */
export const CUSTOM_PREFIX = 'custom:'
export const customKey = (id: string) => `${CUSTOM_PREFIX}${id}`
export const customIdOf = (key: string | undefined) =>
  key?.startsWith(CUSTOM_PREFIX) ? key.slice(CUSTOM_PREFIX.length) : null

/** At most this many saved stamps; the oldest goes first. */
export const MAX_SAVED_STAMPS = 20

const DB_NAME = 'wz-stamps'
const DB_VERSION = 1
const STAMPS = 'stamps'
/** Last size per preset (`approved`, …) — presets have no image to save. */
const SIZES = 'sizes'

let dbPromise: Promise<IDBDatabase | null> | null = null
// Fallback when IndexedDB cannot be opened: the session still works.
const memoryStamps = new Map<string, SavedStamp>()
const memorySizes = new Map<string, StampSize>()

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STAMPS)) db.createObjectStore(STAMPS, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(SIZES)) db.createObjectStore(SIZES)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function run<T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(db => new Promise(resolve => {
    if (!db) { resolve(null); return }
    try {
      const req = work(db.transaction(store, mode).objectStore(store))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  }))
}

/** Saved stamps, newest first. */
export async function listStamps(): Promise<SavedStamp[]> {
  const stored = await run<SavedStamp[]>(STAMPS, 'readonly', s => s.getAll())
  const all = stored ?? [...memoryStamps.values()]
  return [...all].sort((a, b) => b.createdAt - a.createdAt)
}

/** Add a stamp; beyond MAX_SAVED_STAMPS the oldest are dropped. */
export async function addStamp(stamp: SavedStamp): Promise<SavedStamp[]> {
  memoryStamps.set(stamp.id, stamp)
  await run(STAMPS, 'readwrite', s => s.put(stamp))
  const all = await listStamps()
  for (const old of all.slice(MAX_SAVED_STAMPS)) await removeStamp(old.id)
  return all.slice(0, MAX_SAVED_STAMPS)
}

export async function removeStamp(id: string): Promise<void> {
  memoryStamps.delete(id)
  await run(STAMPS, 'readwrite', s => s.delete(id))
}

/**
 * Remember the size a stamp was just given, so the next one comes out the
 * same. `key` is a preset id or `custom:<id>`.
 */
export async function rememberSize(key: string, size: StampSize): Promise<void> {
  const customId = customIdOf(key)
  if (customId) {
    const stamp = memoryStamps.get(customId)
      ?? (await run<SavedStamp>(STAMPS, 'readonly', s => s.get(customId)))
      ?? undefined
    if (!stamp) return
    const next = { ...stamp, ...size }
    memoryStamps.set(customId, next)
    await run(STAMPS, 'readwrite', s => s.put(next))
    return
  }
  memorySizes.set(key, size)
  await run(SIZES, 'readwrite', s => s.put(size, key))
}

/** The size last given to a preset, if any. */
export async function presetSize(presetId: string): Promise<StampSize | null> {
  return memorySizes.get(presetId) ?? (await run<StampSize>(SIZES, 'readonly', s => s.get(presetId))) ?? null
}

/** Test hook: forget the open database and the in-memory copy. */
export function resetStampLibraryForTests(): void {
  dbPromise = null
  memoryStamps.clear()
  memorySizes.clear()
}
