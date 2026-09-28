import type { PDFDocument } from '@cantoo/pdf-lib'

/**
 * The fontkit handed to `PDFDocument.registerFontkit`. Lazy: it is only needed
 * when a save embeds the Korean font.
 *
 * This is `fontkit` v2, the one `@cantoo/pdf-lib` is built against — not
 * `@pdf-lib/fontkit`, which the app used until 1.19.2 and which failed twice
 * over under the fork:
 *
 * - The fork serializes a subset with `subset.encode()` whenever that method
 *   exists, assuming v2's zero-argument form. `@pdf-lib/fontkit`'s `encode`
 *   takes a stream, so every subsetted font threw at `save()` — every save
 *   carrying Korean text since the switch to the fork (a Korean watermark or
 *   text edit, HWP/image → PDF with its text layer).
 * - Even with that routed around, its CFF subsetter drops glyphs from Noto Sans
 *   KR: "대외비 계약서" rendered as "대외비" and a blank. Upstream pdf-lib does
 *   the same, so this predates the fork. v2 renders every glyph, at ~32 KB per
 *   file against 3.8 MB for embedding the whole face.
 */
export async function loadFontkit(): Promise<Parameters<PDFDocument['registerFontkit']>[0]> {
  return import('fontkit')
}
