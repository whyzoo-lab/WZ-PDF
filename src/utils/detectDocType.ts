const OLE2 = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]
const PDF  = [0x25, 0x50, 0x44, 0x46]            // %PDF
const ZIP  = [0x50, 0x4B, 0x03, 0x04]            // PK\x03\x04

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false
  return true
}

/** Identify a document by magic bytes, with the file extension as tiebreaker. */
export function detectDocType(name: string, bytes: ArrayBuffer): 'pdf' | 'hwp' | 'unknown' {
  const head = new Uint8Array(bytes.slice(0, 8))
  const ext = name.toLowerCase().split('.').pop() ?? ''

  if (startsWith(head, PDF) || ext === 'pdf') return 'pdf'
  if (startsWith(head, OLE2)) return 'hwp'                 // .hwp binary (OLE2)
  if (startsWith(head, ZIP) && ext === 'hwpx') return 'hwp' // .hwpx (zip)
  // Bytes too short / unreadable: trust the extension.
  if (head.length < 4 && (ext === 'hwp' || ext === 'hwpx')) return 'hwp'
  return 'unknown'
}
