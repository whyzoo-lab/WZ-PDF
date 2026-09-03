const OLE2 = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]
const PDF  = [0x25, 0x50, 0x44, 0x46]            // %PDF
const ZIP  = [0x50, 0x4B, 0x03, 0x04]            // PK\x03\x04
// Bitmaps — decoded by the browser itself, so we only need to recognise them.
const PNG  = [0x89, 0x50, 0x4E, 0x47]            // \x89PNG
const JPEG = [0xFF, 0xD8, 0xFF]
const GIF  = [0x47, 0x49, 0x46, 0x38]            // GIF8
const BMP  = [0x42, 0x4D]                        // BM
const RIFF = [0x52, 0x49, 0x46, 0x46]            // RIFF … WEBP

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false
  return true
}

/**
 * Cheap MIME/extension classification for upload/drop gating — no byte read
 * (the authoritative magic-byte routing happens later in usePdfDocument via
 * detectDocType). The PDF rule is permissive (`type` contains "pdf" OR .pdf
 * extension) so browser MIME quirks don't reject valid files.
 */
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'avif', 'ico']
const MARKDOWN_EXTS = ['md', 'markdown', 'mdown', 'mkd']

/**
 * The `accept` list for every file picker that opens a document. It lived in
 * two places and drifted: the toolbar's "open" menu still said pdf/hwp/hwpx
 * long after mail, Markdown and images were supported, so opening one of those
 * from the menu filtered it out while F2 and double-click let it through.
 */
export const DOCUMENT_ACCEPT =
  'application/pdf,.pdf,.hwp,.hwpx,.eml,message/rfc822,image/*,.bmp,.md,.markdown,text/markdown'

export function classifyDocFile(file: File): {
  isPdf: boolean; isHwp: boolean; isEml: boolean; isImage: boolean; isMarkdown: boolean
  supported: boolean
} {
  const name = file.name.toLowerCase()
  const ext = name.split('.').pop() ?? ''
  const isPdf = file.type.includes('pdf') || name.endsWith('.pdf')
  const isHwp = name.endsWith('.hwp') || name.endsWith('.hwpx')
  const isEml = file.type === 'message/rfc822' || name.endsWith('.eml')
  const isImage = file.type.startsWith('image/') || IMAGE_EXTS.includes(ext)
  const isMarkdown = file.type === 'text/markdown' || MARKDOWN_EXTS.includes(ext)
  return {
    isPdf, isHwp, isEml, isImage, isMarkdown,
    supported: isPdf || isHwp || isEml || isImage || isMarkdown,
  }
}

/**
 * Does this look like an RFC 5322 message? .eml has no magic number, so the
 * check is structural: the file must open with header lines, one of which is a
 * header only a real message carries. Used as a fallback for files that arrive
 * without a usable extension — the extension itself is checked first.
 */
function looksLikeEmail(head: string): boolean {
  const firstLine = head.split(/\r?\n/, 1)[0] ?? ''
  if (!/^[A-Za-z][A-Za-z0-9-]*:\s/.test(firstLine)) return false
  return /^(?:from|to|subject|date|received|return-path|message-id|mime-version|delivered-to):/im
    .test(head)
}

/** Identify a document by magic bytes, with the file extension as tiebreaker. */
export function detectDocType(
  name: string,
  bytes: ArrayBuffer,
): 'pdf' | 'hwp' | 'eml' | 'image' | 'md' | 'unknown' {
  const head = new Uint8Array(bytes.slice(0, 16))
  const ext = name.toLowerCase().split('.').pop() ?? ''

  // Magic bytes are authoritative (a wrong/forced extension must not override them).
  if (startsWith(head, PDF)) return 'pdf'                    // %PDF
  if (startsWith(head, OLE2)) return 'hwp'                   // .hwp binary (OLE2)
  if (startsWith(head, ZIP)) {
    // .hwpx is an OCF zip: the first entry is an uncompressed `mimetype` holding
    // `application/hwp+zip`. Sniffing that beats trusting the name — the Viewer
    // EXE hands its payload over as "document.pdf", so an extension-only rule
    // sent embedded HWPX files to pdfjs and they failed to open.
    const zipHead = new TextDecoder('ascii', { fatal: false })
      .decode(new Uint8Array(bytes.slice(0, 256)))
    if (zipHead.includes('application/hwp+zip')) return 'hwp'
    if (ext === 'hwpx') return 'hwp'
  }
  if (startsWith(head, PNG) || startsWith(head, JPEG) ||
      startsWith(head, GIF) || startsWith(head, BMP)) return 'image'
  // WEBP is RIFF with a 'WEBP' tag at byte 8 — RIFF alone is also .wav/.avi.
  if (startsWith(head, RIFF) &&
      String.fromCharCode(...head.slice(8, 12)) === 'WEBP') return 'image'

  // Message headers are also content, so this is checked before the extension:
  // a real PDF/HWP/image already matched above, and the Viewer EXE presents its
  // payload as "document.pdf" regardless of what was embedded.
  const text = new TextDecoder('ascii', { fatal: false })
    .decode(new Uint8Array(bytes.slice(0, 2048)))
  if (looksLikeEmail(text)) return 'eml'

  // Extension fallback when the bytes are inconclusive (short/unreadable, or a
  // generic container like zip).
  if (ext === 'pdf') return 'pdf'
  if (ext === 'hwp' || ext === 'hwpx') return 'hwp'
  if (ext === 'eml') return 'eml'
  if (IMAGE_EXTS.includes(ext)) return 'image'
  // Markdown is plain text with no signature, so the name is all we have.
  if (MARKDOWN_EXTS.includes(ext)) return 'md'
  return 'unknown'
}
