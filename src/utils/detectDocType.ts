const OLE2 = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]
const PDF  = [0x25, 0x50, 0x44, 0x46]            // %PDF
const ZIP  = [0x50, 0x4B, 0x03, 0x04]            // PK\x03\x04
// Bitmaps — decoded by the browser itself, so we only need to recognise them.
const PNG  = [0x89, 0x50, 0x4E, 0x47]            // \x89PNG
const JPEG = [0xFF, 0xD8, 0xFF]
const GIF  = [0x47, 0x49, 0x46, 0x38]            // GIF8
const BMP  = [0x42, 0x4D]                        // BM
const RIFF = [0x52, 0x49, 0x46, 0x46]            // RIFF … WEBP
const TIFF_LE = [0x49, 0x49, 0x2A, 0x00]         // II*\0
const TIFF_BE = [0x4D, 0x4D, 0x00, 0x2A]         // MM\0*

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
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'avif', 'ico', 'tif', 'tiff']
const MARKDOWN_EXTS = ['md', 'markdown', 'mdown', 'mkd']
/** Word documents. Only the XML format: legacy .doc has no light reader. */
export const WORD_EXTS = ['docx']
/** PowerPoint decks. Likewise XML only — no legacy .ppt. */
export const SLIDE_EXTS = ['pptx']
/** Spreadsheets hucre reads — legacy .xls included (values and merges only). */
export const SHEET_EXTS = ['xlsx', 'xlsm', 'xls', 'ods', 'csv']

/**
 * The `accept` list for every file picker that opens a document. It lived in
 * two places and drifted: the toolbar's "open" menu still said pdf/hwp/hwpx
 * long after mail, Markdown and images were supported, so opening one of those
 * from the menu filtered it out while F2 and double-click let it through.
 */
export const DOCUMENT_ACCEPT =
  'application/pdf,.pdf,.hwp,.hwpx,.eml,message/rfc822,image/*,.bmp,.tif,.tiff,.md,.markdown,text/markdown,'
  + '.docx,.pptx,.xlsx,.xlsm,.xls,.ods,.csv,text/csv,.zip,application/zip'

export function classifyDocFile(file: File): {
  isPdf: boolean; isHwp: boolean; isEml: boolean; isImage: boolean; isMarkdown: boolean
  isOffice: boolean
  supported: boolean
} {
  const name = file.name.toLowerCase()
  const ext = name.split('.').pop() ?? ''
  const isPdf = file.type.includes('pdf') || name.endsWith('.pdf')
  const isHwp = name.endsWith('.hwp') || name.endsWith('.hwpx')
  const isEml = file.type === 'message/rfc822' || name.endsWith('.eml')
  // A ZIP of pictures opens as one collection; any other ZIP fails with a message.
  const isImage = file.type.startsWith('image/') || IMAGE_EXTS.includes(ext) || ext === 'zip' || file.type === 'application/zip'
  const isMarkdown = file.type === 'text/markdown' || MARKDOWN_EXTS.includes(ext)
  const isOffice = WORD_EXTS.includes(ext) || SLIDE_EXTS.includes(ext) || SHEET_EXTS.includes(ext)
  return {
    isPdf, isHwp, isEml, isImage, isMarkdown, isOffice,
    supported: isPdf || isHwp || isEml || isImage || isMarkdown || isOffice,
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

/**
 * Which Office package a zip is, from the part names in its central directory.
 *
 * The directory sits at the end of the archive and names every part, so its
 * tail is where `word/document.xml` or `xl/workbook.xml` can be found without
 * unzipping anything. A package too large for the window falls back to the
 * extension, which is no worse than before.
 */
function officeZipKind(bytes: ArrayBuffer): 'docx' | 'pptx' | 'sheet' | null {
  const tail = new TextDecoder('latin1').decode(
    new Uint8Array(bytes.slice(Math.max(0, bytes.byteLength - 256 * 1024))),
  )
  if (tail.includes('word/document.xml')) return 'docx'
  if (tail.includes('ppt/presentation.xml')) return 'pptx'
  if (tail.includes('xl/workbook.xml') || tail.includes('xl/workbook.bin')) return 'sheet'
  const head = new TextDecoder('latin1').decode(new Uint8Array(bytes.slice(0, 256)))
  if (head.includes('application/vnd.oasis.opendocument.spreadsheet')) return 'sheet'
  return null
}

/** Identify a document by magic bytes, with the file extension as tiebreaker. */
export function detectDocType(
  name: string,
  bytes: ArrayBuffer,
): 'pdf' | 'hwp' | 'eml' | 'image' | 'md' | 'docx' | 'pptx' | 'sheet' | 'unknown' {
  const head = new Uint8Array(bytes.slice(0, 16))
  const ext = name.toLowerCase().split('.').pop() ?? ''

  // Magic bytes are authoritative (a wrong/forced extension must not override them).
  if (startsWith(head, PDF)) return 'pdf'                    // %PDF
  // OLE2 is a container, not a format: .hwp and legacy .xls both use it, and
  // what tells them apart is a stream name deep inside. The extension decides
  // between the two; anything else stays HWP, as it always was.
  if (startsWith(head, OLE2)) return ext === 'xls' ? 'sheet' : 'hwp'
  if (startsWith(head, ZIP)) {
    // .hwpx is an OCF zip: the first entry is an uncompressed `mimetype` holding
    // `application/hwp+zip`. Sniffing that beats trusting the name — the Viewer
    // EXE hands its payload over as "document.pdf", so an extension-only rule
    // sent embedded HWPX files to pdfjs and they failed to open.
    const zipHead = new TextDecoder('ascii', { fatal: false })
      .decode(new Uint8Array(bytes.slice(0, 256)))
    if (zipHead.includes('application/hwp+zip')) return 'hwp'
    if (ext === 'hwpx') return 'hwp'
    const office = officeZipKind(bytes)
    if (office) return office
    // A ZIP named as one is read as a collection of pictures (what "save
    // images" writes); one with none inside says so when it is opened.
    if (ext === 'zip') return 'image'
  }
  if (startsWith(head, PNG) || startsWith(head, JPEG) ||
      startsWith(head, GIF) || startsWith(head, BMP) ||
      startsWith(head, TIFF_LE) || startsWith(head, TIFF_BE)) return 'image'
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
  if (WORD_EXTS.includes(ext)) return 'docx'
  if (SLIDE_EXTS.includes(ext)) return 'pptx'
  if (SHEET_EXTS.includes(ext)) return 'sheet'
  return 'unknown'
}
