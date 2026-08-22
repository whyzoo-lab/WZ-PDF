import type { DocKind, ViewerDoc } from '../types/viewerDoc'

/**
 * Getting speakable text out of each format.
 *
 * Every path here produces the same shape: lines within a block separated by a
 * single newline, blocks separated by a blank line. That is the contract
 * `normalizeForSpeech` depends on, and honouring it is the whole job — a
 * heading, a table cell and a wrapped line all look identical once they are
 * plain characters, so the structure has to be captured here, where the format
 * still knows it.
 */

/**
 * Text with a box around it.
 *
 * Both rhwp's `HwpTextRun` and OCR's `OcrWord` satisfy this, which is the point:
 * a scanned page and a native one differ in where the runs come from, not in
 * what has to be done with them.
 */
export interface PositionedRun {
  text: string
  x: number
  y: number
  height: number
  /** Both sources carry it; nothing here needs it, but rejecting it would mean
   *  callers had to strip real data down to fit. */
  width?: number
}

/** A positioned line of text, before it is grouped into blocks. */
export interface PositionedLine {
  text: string
  /** Vertical position, in whatever units the source uses. */
  y: number
  /** Typical glyph height on this line, used to judge what gap is a new block. */
  height: number
}

/**
 * A gap larger than this many line-heights starts a new block.
 *
 * Normal leading is around 1.2 line-heights, and a paragraph break is visibly
 * more. Sitting between the two means ordinary wrapped lines stay joined while
 * genuine breaks survive.
 */
const BLOCK_GAP_RATIO = 1.8

/**
 * Join lines into blocks using vertical spacing.
 *
 * Lines are expected in reading order. Ordering by position instead would be
 * wrong for multi-column pages, where the format's own order is the only thing
 * that knows the columns apart.
 */
export function groupLinesIntoBlocks(lines: readonly PositionedLine[]): string {
  const out: string[] = []
  let previous: PositionedLine | null = null

  for (const line of lines) {
    if (!line.text.trim()) continue
    if (previous) {
      const gap = Math.abs(previous.y - line.y)
      const reference = Math.max(previous.height, line.height, 1)
      out.push(gap > reference * BLOCK_GAP_RATIO ? '\n\n' : '\n')
    }
    out.push(line.text.trim())
    previous = line
  }
  return out.join('')
}

/** The bits of a pdfjs text item this needs; pdfjs types are not imported here. */
interface PdfTextItem {
  str?: string
  hasEOL?: boolean
  height?: number
  /** [a, b, c, d, e, f] — e is x, f is y. */
  transform?: number[]
}

/**
 * Rebuild lines from a pdfjs text content stream.
 *
 * pdfjs emits positioned runs, not lines: `hasEOL` marks where the page's line
 * ended. Runs before that belong on one line and must be concatenated without
 * inventing spaces, because a PDF already encodes its own spacing as runs.
 */
export function linesFromPdfItems(items: readonly unknown[]): PositionedLine[] {
  const lines: PositionedLine[] = []
  let text = ''
  let y = 0
  let height = 0

  for (const raw of items) {
    const item = raw as PdfTextItem
    if (typeof item.str !== 'string') continue
    text += item.str
    y = item.transform?.[5] ?? y
    height = Math.max(height, item.height ?? 0)
    if (item.hasEOL) {
      lines.push({ text, y, height })
      text = ''
      height = 0
    }
  }
  if (text.trim()) lines.push({ text, y, height })
  return lines
}

/**
 * Rebuild lines from positioned runs.
 *
 * Runs on the same visual line share a baseline but arrive as separate items —
 * one per formatting change from rhwp, one per detected box from OCR — so they
 * are merged when their `y` differs by less than half a line height.
 *
 * The two sources have the same shape for this purpose, which is why they share
 * the code: `HwpTextRun` and `OcrWord` are both text plus a box.
 */
export function linesFromRuns(runs: readonly PositionedRun[]): PositionedLine[] {
  const lines: PositionedLine[] = []
  let current: { parts: { x: number; text: string }[]; y: number; height: number } | null = null

  const flush = () => {
    if (!current) return
    // Sorted by x so a run emitted out of order still reads left to right.
    const text = [...current.parts].sort((a, b) => a.x - b.x).map(p => p.text).join('')
    lines.push({ text, y: current.y, height: current.height })
    current = null
  }

  for (const run of runs) {
    if (!run.text) continue
    const height = run.height || 10
    if (current && Math.abs(current.y - run.y) <= Math.max(current.height, height) / 2) {
      current.parts.push({ x: run.x, text: run.text })
      current.height = Math.max(current.height, height)
      continue
    }
    flush()
    current = { parts: [{ x: run.x, text: run.text }], y: run.y, height }
  }
  flush()
  return lines
}

/** Block-level tags whose text is one utterance. Mirrors useFlowSearch's list. */
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre, dt, dd, figcaption'

/**
 * Text from a reflowing document (Markdown, mail).
 *
 * These already carry their structure as elements, so no geometry guessing is
 * needed: each block element is one block, which is exactly the contract.
 */
export function textFromElement(root: HTMLElement): string {
  const blocks: string[] = []
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))) {
    // Skip a block that only wraps other blocks, or its text is spoken twice.
    if (el.querySelector(BLOCK_SELECTOR)) continue
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
    if (text) blocks.push(text)
  }
  if (blocks.length === 0) {
    const fallback = (root.innerText || root.textContent || '').trim()
    return fallback
  }
  return blocks.join('\n\n')
}

export interface PageRange {
  /** 1-based, inclusive. */
  from: number
  to: number
}

export interface TextFromPagesOptions {
  /**
   * Recognized text for a page, when OCR has already run on it.
   *
   * This is what makes a scanned document readable at all: an image-only PDF
   * has an empty text layer, so without it the reader has literally nothing to
   * say. OCR boxes are not in guaranteed reading order, so they are sorted here
   * rather than trusted the way a format's own runs are.
   */
  ocrRuns?: (pageNumber: number) => readonly PositionedRun[] | undefined
}

/**
 * Collect the text of a paginated document.
 *
 * Pages are separated by a blank line for the same reason blocks are: the last
 * line of one page and the first of the next are rarely one sentence, and
 * joining them produces a sentence that never existed.
 *
 * Native text wins over OCR wherever it exists — it is exact, while recognition
 * is a guess — and OCR fills in per page, so a document that is text for twenty
 * pages and a scan for one reads correctly throughout.
 */
export async function textFromPages(
  doc: ViewerDoc,
  kind: DocKind,
  range: PageRange,
  options: TextFromPagesOptions = {},
): Promise<string> {
  const parts: string[] = []
  const from = Math.max(1, range.from)
  const to = Math.min(doc.numPages, range.to)

  for (let pageNumber = from; pageNumber <= to; pageNumber++) {
    let lines: PositionedLine[]
    if (kind === 'hwp' && doc.getPageText) {
      lines = linesFromRuns(await doc.getPageText(pageNumber))
    } else {
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      lines = linesFromPdfItems(content.items)
    }

    if (lines.every(line => !line.text.trim())) {
      const recognized = options.ocrRuns?.(pageNumber)
      if (recognized && recognized.length > 0) {
        const ordered = [...recognized].sort((a, b) => (a.y - b.y) || (a.x - b.x))
        lines = linesFromRuns(ordered)
      }
    }

    const text = groupLinesIntoBlocks(lines).trim()
    if (text) parts.push(text)
  }
  return parts.join('\n\n')
}
