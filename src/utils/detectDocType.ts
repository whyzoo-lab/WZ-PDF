const OLE2 = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]
const PDF  = [0x25, 0x50, 0x44, 0x46]            // %PDF
const ZIP  = [0x50, 0x4B, 0x03, 0x04]            // PK\x03\x04

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
export function classifyDocFile(file: File): {
  isPdf: boolean; isHwp: boolean; isEml: boolean; supported: boolean
} {
  const name = file.name.toLowerCase()
  const isPdf = file.type.includes('pdf') || name.endsWith('.pdf')
  const isHwp = name.endsWith('.hwp') || name.endsWith('.hwpx')
  const isEml = file.type === 'message/rfc822' || name.endsWith('.eml')
  return { isPdf, isHwp, isEml, supported: isPdf || isHwp || isEml }
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
export function detectDocType(name: string, bytes: ArrayBuffer): 'pdf' | 'hwp' | 'eml' | 'unknown' {
  const head = new Uint8Array(bytes.slice(0, 8))
  const ext = name.toLowerCase().split('.').pop() ?? ''

  // Magic bytes are authoritative (a wrong/forced extension must not override them).
  if (startsWith(head, PDF)) return 'pdf'                    // %PDF
  if (startsWith(head, OLE2)) return 'hwp'                   // .hwp binary (OLE2)
  if (startsWith(head, ZIP) && ext === 'hwpx') return 'hwp'  // .hwpx (zip)

  // Extension fallback when the bytes are inconclusive (short/unreadable, or a
  // generic container like zip).
  if (ext === 'pdf') return 'pdf'
  if (ext === 'hwp' || ext === 'hwpx') return 'hwp'
  if (ext === 'eml') return 'eml'

  // No extension to go on: sniff for message headers. Read as ASCII — a real
  // message's headers are ASCII by definition, and a binary file will not match.
  const text = new TextDecoder('ascii', { fatal: false })
    .decode(new Uint8Array(bytes.slice(0, 2048)))
  if (looksLikeEmail(text)) return 'eml'
  return 'unknown'
}
