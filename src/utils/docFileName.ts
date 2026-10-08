import type { DocKind } from '../types/viewerDoc'
import { safeFilename } from './download'

/** Every extension the app opens — what a saved or embedded copy may be called. */
const OPENABLE_EXTS = [
  'pdf', 'hwp', 'hwpx', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp',
  'docx', 'pptx', 'xlsx', 'xlsm', 'xls', 'ods', 'csv', 'eml', 'md', 'markdown', 'mdown', 'mkd',
]

/** The extension of `name`, lower-case, or '' when it has none the app opens. */
export function openableExt(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name)
  const ext = m ? m[1].toLowerCase() : ''
  return OPENABLE_EXTS.includes(ext) ? ext : ''
}

const at = (b: Uint8Array, i: number, ...v: number[]) => v.every((x, n) => b[i + n] === x)

/** What the bytes say they are, for a name that does not say. */
function extFromBytes(kind: DocKind, b: Uint8Array): string {
  switch (kind) {
    case 'pdf': return 'pdf'
    case 'hwp': return at(b, 0, 0xd0, 0xcf, 0x11, 0xe0) ? 'hwp' : 'hwpx'
    case 'image':
      if (at(b, 0, 0x89, 0x50, 0x4e, 0x47)) return 'png'
      if (at(b, 0, 0xff, 0xd8, 0xff)) return 'jpg'
      if (at(b, 0, 0x47, 0x49, 0x46)) return 'gif'
      if (at(b, 0, 0x42, 0x4d)) return 'bmp'
      return 'webp'
    case 'docx': return 'docx'
    case 'pptx': return 'pptx'
    case 'sheet':
      if (at(b, 0, 0xd0, 0xcf, 0x11, 0xe0)) return 'xls'
      return at(b, 0, 0x50, 0x4b, 0x03, 0x04) ? 'xlsx' : 'csv'
    case 'md': return 'md'
    case 'eml': return 'eml'
  }
}

/**
 * The name to save or embed a document under: its own, when that already ends
 * in an extension the app opens; otherwise with one added from what it is. A
 * document opened from a URL often arrives as "download" or "view?id=17", and
 * a name without its extension is one the viewer exe would refuse to open.
 */
export function documentFileName(name: string | undefined, kind: DocKind, bytes: ArrayBuffer | Uint8Array): string {
  // Safe for the OS first: a name from a URL can carry `?`, `/` and the like.
  const base = safeFilename((name ?? '').trim(), 'document')
  if (openableExt(base)) return base
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength))
  return `${base}.${extFromBytes(kind, b)}`
}
