// The shapes of the Fill & Sign marks, in their box's own 0–1 space, shared by
// the screen (FillLayer), print (annotationCanvas) and the saved PDF
// (pdfExporter) so the three draw the same thing.

import type { FillMark } from '../types/annotation'
import { LANG } from '../i18n'

/** Polylines of a mark (each a list of [x, y] in 0–1, y down), or a dot. */
export function markShape(mark: Exclude<FillMark, 'text'>): { lines: [number, number][][]; dot?: { cx: number; cy: number; r: number } } {
  switch (mark) {
    case 'check': return { lines: [[[0.15, 0.55], [0.4, 0.8], [0.87, 0.2]]] }
    case 'cross': return { lines: [[[0.2, 0.2], [0.8, 0.8]], [[0.8, 0.2], [0.2, 0.8]]] }
    case 'line': return { lines: [[[0, 0.5], [1, 0.5]]] }
    case 'dot': return { lines: [], dot: { cx: 0.5, cy: 0.5, r: 0.28 } }
  }
}

/** Stroke width of a mark, as a share of its box's height. */
export const MARK_STROKE = 0.12

/** Default sizes, PDF points. */
export const FILL_TEXT_SIZE = 12
export const FILL_MARK_SIZE = 14

/** Where the baseline sits below the top of a text item, as a share of its font size. */
export const FILL_BASELINE = 0.88

/** Today, as the reader writes a date (2026. 10. 17. / 10/17/2026). */
export function todayText(now = new Date()): string {
  return now.toLocaleDateString(LANG === 'ko' ? 'ko-KR' : 'en-US')
}

/** A text item's box, from its text and size (the screen measures it exactly; this is the first guess). */
export function textBox(text: string, fontSize: number): { width: number; height: number } {
  let units = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    // Hangul, CJK and full-width forms are about a square each; the rest about half.
    const wide = (c >= 0x1100 && c <= 0x11ff) || (c >= 0x3000 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xff00 && c <= 0xffef)
    units += wide ? 1 : 0.56
  }
  return { width: Math.max(fontSize * 2, units * fontSize + 4), height: fontSize * 1.25 }
}
