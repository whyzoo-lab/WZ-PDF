// How wide Excel makes a column, and what it shows when a number does not fit.
//
// Column widths are stored in "characters": multiples of the widest digit of
// the workbook's default font (its Normal style). That width is 7 px in
// Calibri 11 but 8 px in 맑은 고딕 11, the default of Korean Excel. Taking 7 for
// every workbook made a Korean sheet's columns about 12 % narrower than Excel
// draws them, and the text kept its real size, so a number that fits in Excel
// lost its last digits.
//
// A number Excel cannot fit is never cut. In General format it is shown with
// fewer decimals, then in scientific form; in any other format, or when even
// that is too wide, the cell is filled with '#'. Cutting it instead showed a
// different number: 1234567 as 12345.

/**
 * What `.wz-sheet-table` falls back to (`--wz-sheet-font` in index.css). Canvas
 * cannot read a CSS variable, so the list is repeated here: keep the two equal.
 */
export const SHEET_FONT_STACK = "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', Calibri, Arial, sans-serif"

export interface FontSpec {
  family?: string | null
  /** Points; 11 when absent, as in Excel. */
  sizePt?: number
  bold?: boolean
  italic?: boolean
}

/** Width of `text` in `font`, in CSS pixels. */
export type Measure = (text: string, font: FontSpec) => number

/**
 * Room a cell gives its text before the cell's edge clips it, in px less than
 * the cell's width: the left padding (3 px) and the right border (1 px). Text
 * that is wider than the content box runs on into the right padding, which
 * `overflow: hidden` still shows.
 */
export const CELL_TEXT_INSET = 4

export function canvasFont(font: FontSpec): string {
  const px = (font.sizePt ?? 11) * 96 / 72
  const family = font.family ? `"${font.family}", ` : ''
  return `${font.italic ? 'italic ' : ''}${font.bold ? '700 ' : ''}${px}px ${family}${SHEET_FONT_STACK}`
}

/**
 * Where nothing can measure text (tests, Node): about the width of a digit per
 * character, Calibri's digits being narrower than everyone else's.
 */
export const estimateText: Measure = (text, font) => {
  const px = (font.sizePt ?? 11) * 96 / 72
  const em = !font.family || /calibri/i.test(font.family) ? 0.507 : 0.55
  return text.length * px * em
}

const CACHE_LIMIT = 50_000

function canvasMeasure(): Measure | null {
  // OffscreenCanvas, not a <canvas> element: jsdom has none and says so, where
  // an element's getContext would print "not implemented" on every test run.
  if (typeof OffscreenCanvas === 'undefined') return null
  let ctx: OffscreenCanvasRenderingContext2D | null = null
  try { ctx = new OffscreenCanvas(1, 1).getContext('2d') } catch { /* no 2D context */ }
  if (!ctx) return null
  const cache = new Map<string, number>()
  let current = ''
  return (text, font) => {
    const css = canvasFont(font)
    const key = `${css}\n${text}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    if (css !== current) { ctx.font = css; current = css }
    const width = ctx.measureText(text).width
    if (cache.size >= CACHE_LIMIT) cache.clear()
    cache.set(key, width)
    return width
  }
}

let shared: Measure | null | undefined

/** Measures text as the page draws it, or estimates where nothing can. */
export function textMeasure(): Measure {
  if (shared === undefined) shared = canvasMeasure()
  return shared ?? estimateText
}

/** Excel's "maximum digit width": the widest of 0–9, in whole pixels. */
export function maxDigitWidth(font: FontSpec, measure: Measure): number {
  let widest = 0
  for (let d = 0; d <= 9; d++) widest = Math.max(widest, measure(String(d), font))
  return Math.max(1, Math.round(widest))
}

/**
 * A column width as the file stores it (digit widths, padding included) in
 * pixels — ECMA-376 §18.3.1.13. Calibri 11: 9.140625 → 64 px; 맑은 고딕 11:
 * 9 → 72 px.
 */
export function colWidthPx(width: number, mdw: number): number {
  return Math.max(0, Math.trunc(((256 * width + Math.trunc(128 / mdw)) / 256) * mdw))
}

/**
 * The width of a column the sheet says nothing about: eight digits and 5 px of
 * padding, rounded up to a multiple of 8 px — 64 px in Calibri 11, 72 in
 * 맑은 고딕 11.
 */
export function defaultColPx(mdw: number, baseColWidth = 8): number {
  return Math.ceil((baseColWidth * mdw + 5) / 8) * 8
}

/** `value` in scientific form as Excel's General writes it: 1.23457E+11. */
export function scientific(value: number, digits: number): string {
  return value.toExponential(digits)
    .replace(/\.?0+e/, 'e')
    .replace('e', 'E')
    .replace(/E([+-])(\d)$/, 'E$10$2')
}

/**
 * Shorter forms of a General number, best first: fewer decimals, then
 * scientific with fewer digits.
 */
export function shorterGeneral(value: number, shown: string): string[] {
  const out: string[] = []
  const add = (s: string) => { if (s !== shown && !out.includes(s)) out.push(s) }
  if (!shown.includes('E')) {
    const dot = shown.indexOf('.')
    const decimals = dot === -1 ? 0 : shown.length - dot - 1
    for (let d = decimals - 1; d >= 0; d--) {
      const s = String(Number(value.toFixed(d)))
      if (!/e/i.test(s)) add(s)
    }
  }
  for (let d = 5; d >= 0; d--) add(scientific(value, d))
  return out
}

/**
 * What a cell shows for a number (or date) `shown`, given `room` px for it:
 * itself if it fits; for General, the first shorter form that fits; else
 * enough '#' to fill the cell, as Excel draws it.
 */
export function fitNumber(
  value: number | Date, shown: string, general: boolean,
  room: number, font: FontSpec, measure: Measure,
): string {
  if (shown === '' || measure(shown, font) <= room) return shown
  if (general && typeof value === 'number' && Number.isFinite(value)) {
    for (const s of shorterGeneral(value, shown)) if (measure(s, font) <= room) return s
  }
  const hash = Math.max(1, measure('#', font))
  return '#'.repeat(Math.max(1, Math.floor(room / hash)))
}
