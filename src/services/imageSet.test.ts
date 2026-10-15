// Opening a picture brings its folder, and must not read the folder to do it:
// the opened picture shows as soon as it is decoded, and each other page reads
// its file when it is first laid out.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { collectionForImage, readManifest } from './imageSet'
import { createImageSetDoc } from './imageDocAdapter'
import { rememberPath } from './documentPaths'

const be32 = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]
const png = (w: number, h: number) => new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 6, 0, 0, 0,
]).buffer

const DIR = 'C:\\pics'
const names = ['a.png', 'b.png', 'c.png', 'd.png']
const sizes: Record<string, [number, number]> = { 'a.png': [800, 600], 'b.png': [400, 300], 'c.png': [1000, 500], 'd.png': [600, 600] }

let api: { listFolderImages: ReturnType<typeof vi.fn>; readFile: ReturnType<typeof vi.fn>; readFileRange: ReturnType<typeof vi.fn> }

beforeEach(() => {
  const bytesOf = (path: string) => { const [w, h] = sizes[path.split('\\').pop()!]; return png(w, h) }
  api = {
    listFolderImages: vi.fn(async () => names.map(name => ({ path: `${DIR}\\${name}`, name, size: 33 }))),
    readFile: vi.fn(async (path: string) => bytesOf(path)),
    readFileRange: vi.fn(async (path: string) => bytesOf(path)),
  }
  ;(window as unknown as { electronAPI: unknown }).electronAPI = api
})
afterEach(() => { delete (window as unknown as { electronAPI?: unknown }).electronAPI })

async function openC() {
  const file = new File([png(1000, 500)], 'c.png')
  rememberPath(file, `${DIR}\\c.png`)
  return collectionForImage(file, await file.arrayBuffer())
}

describe('a picture opened from its folder', () => {
  it('lists the whole folder, starting at itself, without reading any other file', async () => {
    const manifest = readManifest(await (await openC()).arrayBuffer())
    expect(manifest.entries).toHaveLength(4)
    expect(manifest.start).toBe(2)
    expect(manifest.name).toBe('pics')
    expect(api.readFile).not.toHaveBeenCalled()
    expect(api.readFileRange).not.toHaveBeenCalled()
  })

  it('opens at that picture having read nothing else, and sizes the rest from it until they are read', async () => {
    const doc = await createImageSetDoc(await (await openC()).arrayBuffer())
    expect(doc.startPage).toBe(3)
    expect(api.readFileRange).not.toHaveBeenCalled()
    // Not read yet: assumed to be the opened picture's size.
    expect(doc.pageSizeHint!(1)).toEqual({ width: 1000, height: 500 })

    const page1 = await doc.getPage(1)
    expect(api.readFileRange).toHaveBeenCalledTimes(1)
    expect(page1.getViewport({ scale: 1 })).toMatchObject({ width: 800, height: 600 })
    expect(doc.pageSizeHint!(1)).toEqual({ width: 800, height: 600 })
    expect(doc.pageSizeHint!(2)).toEqual({ width: 1000, height: 500 })
  })

  it('shows a file that is not a picture after all as a page, not a failure', async () => {
    api.readFileRange.mockImplementation(async (path: string) =>
      (path.endsWith('a.png') ? new TextEncoder().encode('not a picture').buffer : png(400, 300)))
    api.readFile.mockImplementation(async () => new TextEncoder().encode('not a picture').buffer)
    const doc = await createImageSetDoc(await (await openC()).arrayBuffer())
    const page1 = await doc.getPage(1)
    expect(page1.getViewport({ scale: 1 })).toMatchObject({ width: 1000, height: 500 })
  })
})
