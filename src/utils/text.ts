/** Text helpers shared by the document readers and the HTML they generate. */

/** Escape for HTML text and double-quoted attributes. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Strict UTF-8, else CP949: Korean notes and Excel's CSVs are still often
 * CP949 without a BOM, so a strict decode that throws is how they are noticed.
 */
export function decodeText(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('euc-kr').decode(bytes)
  }
}

/** Base64 in fixed-size chunks; one `String.fromCharCode(...bytes)` on a
 *  multi-megabyte file overflows the argument limit and throws. */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** A CSS value as the parser reads it: `\75 rl(` is `url(`. */
export function unescapeCss(value: string): string {
  return value
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => {
      const cp = parseInt(hex, 16)
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '�'
    })
    .replace(/\\([^\n])/g, '$1')
}
