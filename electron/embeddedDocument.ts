/**
 * A document carried inside an exported viewer exe.
 *
 * The exe is a copy of the portable app with the document appended, and a
 * trailer at the very end saying how to find it:
 *
 *   V02 (1.25.2+): [document] [name, UTF-8] [name length UInt16LE] [size UInt32LE] [WZPDF_VIEWER_V02]
 *   V01:           [PDF]                                            [size UInt32LE] [WZPDF_VIEWER_V01]
 *
 * V01 could only carry a PDF, so a Word file, a deck or a HWP had to be
 * converted first and arrived as something else. V02 carries the file itself
 * under its own name, which the viewer needs for formats with no signature
 * (Markdown, mail, CSV) and which is what makes it open as what it is.
 *
 * Reading V01 still costs nothing, so it stays: the template an exe is made
 * from is always this same version, but the reader is cheap insurance.
 *
 * The bytes are attacker-controllable — anyone can append to an exe — so what
 * comes out is held to the same rules as a file the app is asked to open: an
 * allowed extension, the signature its format must have, the size cap.
 */

import path from 'path'
import {
  MAX_DOCUMENT_BYTES, hasSupportedDocumentSignature, isAllowedDocumentPath, isTextDocumentPath,
} from './security'

export const EMBED_MARKER_V1 = Buffer.from('WZPDF_VIEWER_V01')
export const EMBED_MARKER_V2 = Buffer.from('WZPDF_VIEWER_V02')
/** The longest trailer: name length (2) + size (4) + marker (16). */
export const EMBED_FOOTER_BYTES = 2 + 4 + 16
const MAX_NAME_BYTES = 255

export interface EmbeddedDocument {
  bytes: Uint8Array
  name: string
}

/**
 * The name a document is carried under: the file's own name, without any
 * folder, of a format the app opens. Null when it is not one.
 */
export function cleanEmbeddedName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = path.basename(raw.replace(/\\/g, '/')).trim()
  if (!name || name === '.' || name === '..') return null
  if (Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES) return null
  // Control characters have no place in a file name shown in a title bar.
  for (const ch of name) if ((ch.codePointAt(0) ?? 0) < 0x20) return null
  return isAllowedDocumentPath(name.toLowerCase()) ? name : null
}

/** Whether `bytes` may be opened as `name`: size, and the format's signature. */
export function isAcceptableDocument(name: string, bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOCUMENT_BYTES) return false
  // Markdown, mail and CSV are text and have no signature to check.
  return isTextDocumentPath(name.toLowerCase()) || hasSupportedDocumentSignature(bytes)
}

/** What goes after the document: name, its length, the size, the marker. */
export function buildTrailer(name: string, size: number): Buffer {
  const nameBytes = Buffer.from(name, 'utf8')
  const tail = Buffer.alloc(6)
  tail.writeUInt16LE(nameBytes.length, 0)
  tail.writeUInt32LE(size, 2)
  return Buffer.concat([nameBytes, tail, EMBED_MARKER_V2])
}

/** Where the document sits in the file, read from the last `EMBED_FOOTER_BYTES`. */
export interface EmbeddedLayout {
  /** Offset of the document. */
  offset: number
  size: number
  /** Offset and length of the UTF-8 name (V02); null for a V01 PDF. */
  name: { offset: number; length: number } | null
}

/**
 * Locate an embedded document from the file's size and its last
 * `EMBED_FOOTER_BYTES` bytes. Null when there is none, or the trailer does not
 * add up (a size that runs past the start of the file).
 */
export function locateEmbedded(fileSize: number, footer: Uint8Array): EmbeddedLayout | null {
  if (fileSize < EMBED_FOOTER_BYTES || footer.byteLength !== EMBED_FOOTER_BYTES) return null
  const buf = Buffer.from(footer.buffer, footer.byteOffset, footer.byteLength)
  const marker = buf.subarray(EMBED_FOOTER_BYTES - 16)
  if (marker.equals(EMBED_MARKER_V2)) {
    const nameLength = buf.readUInt16LE(0)
    const size = buf.readUInt32LE(2)
    if (size === 0 || size > MAX_DOCUMENT_BYTES || nameLength === 0 || nameLength > MAX_NAME_BYTES) return null
    const nameOffset = fileSize - EMBED_FOOTER_BYTES - nameLength
    const offset = nameOffset - size
    if (offset < 0) return null
    return { offset, size, name: { offset: nameOffset, length: nameLength } }
  }
  if (marker.equals(EMBED_MARKER_V1)) {
    // V01's trailer is 4 bytes shorter: its size sits right before the marker.
    const size = buf.readUInt32LE(2)
    if (size === 0 || size > MAX_DOCUMENT_BYTES) return null
    const offset = fileSize - 20 - size
    if (offset < 0) return null
    return { offset, size, name: null }
  }
  return null
}

/** The carried document, checked — or null if it is not one the app may open. */
export function acceptEmbedded(bytes: Uint8Array, rawName: Uint8Array | null): EmbeddedDocument | null {
  if (!rawName) {
    // V01 carried PDFs only.
    if (!isAcceptableDocument('document.pdf', bytes) || Buffer.from(bytes.subarray(0, 4)).toString('ascii') !== '%PDF') return null
    return { bytes, name: 'document.pdf' }
  }
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(rawName)
  } catch {
    return null
  }
  const name = cleanEmbeddedName(decoded)
  if (!name || name !== decoded || !isAcceptableDocument(name, bytes)) return null
  return { bytes, name }
}
