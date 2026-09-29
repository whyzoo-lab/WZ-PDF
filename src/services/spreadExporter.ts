/**
 * "책자 형태로 저장" (save as booklet) — the two-page view, written out as a PDF.
 *
 * Each row of the two-page view (`buildSpreads`: pairs, with a page much wider
 * than the rest on a row of its own) becomes one sheet. That is the layout a
 * booklet is made from: two A4 pages side by side on an A3-landscape sheet, and
 * an A3 drawing on a sheet of its own.
 *
 * Pages are copied, not rasterised — `embedPage` turns each into a form XObject
 * drawn onto the sheet — so text stays sharp, selectable and searchable, and
 * whatever the normal save put on the page (stamps, signatures, watermarks,
 * OCR text) comes along. Link annotations, form fields and bookmarks do not:
 * they belong to the source page, which is not in the new file.
 *
 * Two things the copy must get right to match the screen, because pdfjs shows
 * a page by its CropBox and /Rotate while `embedPage` knows neither:
 *   - the page is embedded by its CropBox, not the default MediaBox;
 *   - /Rotate is applied here, by drawing the form turned and shifted back into
 *     its box (see `drawRotated`).
 */
import { PDFDocument, degrees, type PDFEmbeddedPage, type PDFPage } from '@cantoo/pdf-lib'
import { buildSpreads, median, wideTest, type PageSize } from '../utils/spreadLayout'

export interface SpreadExportOptions {
  /** Password to lock the result with; unlocked when absent. */
  password?: string
}

/** A page's size as shown: its CropBox, turned by its /Rotate. */
function shownSize(page: PDFPage): PageSize & { rotation: number } {
  const { width, height } = page.getCropBox()
  const rotation = ((page.getRotation().angle % 360) + 360) % 360
  const turned = rotation === 90 || rotation === 270
  return { width: turned ? height : width, height: turned ? width : height, rotation }
}

/**
 * Draw `embedded` into the box (x, y, w, h) on `sheet`, turned clockwise by
 * `rotation` as a viewer would show it.
 *
 * `drawPage`'s `rotate` turns counter-clockwise about the draw origin, so a
 * clockwise /Rotate is a negative angle, and the origin moves to the corner the
 * form's own lower-left lands on after turning:
 *   90  → top-left     (x, y + h)
 *   180 → top-right    (x + w, y + h)
 *   270 → bottom-right (x + w, y)
 */
function drawRotated(sheet: PDFPage, embedded: PDFEmbeddedPage, rotation: number, x: number, y: number, w: number, h: number): void {
  const turned = rotation === 90 || rotation === 270
  // The form is drawn at its own (unturned) proportions.
  const width = turned ? h : w
  const height = turned ? w : h
  const origin =
    rotation === 90 ? { x, y: y + h } :
    rotation === 180 ? { x: x + w, y: y + h } :
    rotation === 270 ? { x: x + w, y } :
    { x, y }
  sheet.drawPage(embedded, { ...origin, width, height, rotate: degrees(-rotation) })
}

/** Fit (w, h) inside (boxW, boxH), keeping proportions; the result is centred. */
function fit(w: number, h: number, boxX: number, boxY: number, boxW: number, boxH: number) {
  const s = Math.min(boxW / w, boxH / h)
  const fw = w * s
  const fh = h * s
  return { x: boxX + (boxW - fw) / 2, y: boxY + (boxH - fh) / 2, w: fw, h: fh }
}

/**
 * The sheet every row is placed on: two typical pages side by side.
 *
 * One size for the whole file, because a booklet is printed and bound on one
 * paper size — a sheet that changes size with its content is no use there.
 * "Typical" is the median shown size, so a few odd pages do not set it.
 */
export function sheetSizeFor(sizes: readonly PageSize[]): PageSize {
  if (sizes.length === 0) return { width: 1190.55, height: 841.89 } // A3 landscape
  return { width: 2 * median(sizes.map(s => s.width)), height: median(sizes.map(s => s.height)) }
}

/**
 * `bytes` (an unencrypted PDF) laid out as the two-page view: one sheet per
 * row. A pair fills the two halves; a wide page alone fills the sheet; a page
 * left alone at the end of a run (odd count, or just before a wide page) takes
 * the left half, as it would in a bound book.
 */
export async function exportSpreads(bytes: ArrayBuffer | Uint8Array, options: SpreadExportOptions = {}): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes)
  const pages = source.getPages()
  const shown = pages.map(shownSize)
  const rows = buildSpreads(pages.length, shown)
  const isWide = wideTest(shown)
  // The sheet is two ordinary pages wide; wide pages would inflate it.
  const sheet = sheetSizeFor(shown.filter((_, i) => !isWide(i + 1)))
  const half = sheet.width / 2

  const out = await PDFDocument.create()
  const embedded = await out.embedPages(pages, pages.map(p => {
    const c = p.getCropBox()
    return { left: c.x, bottom: c.y, right: c.x + c.width, top: c.y + c.height }
  }))

  for (const row of rows) {
    const target = out.addPage([sheet.width, sheet.height])
    const place = (pageNumber: number, boxX: number, boxW: number) => {
      const i = pageNumber - 1
      const box = fit(shown[i].width, shown[i].height, boxX, 0, boxW, sheet.height)
      drawRotated(target, embedded[i], shown[i].rotation, box.x, box.y, box.w, box.h)
    }
    if (row.length === 2) {
      place(row[0], 0, half)
      place(row[1], half, half)
    } else if (isWide(row[0])) {
      place(row[0], 0, sheet.width)
    } else {
      // A page left without a partner (before a wide page, or the last one)
      // keeps the left half and the right half stays blank — the blank page a
      // booklet needs there, and the one the two-page view shows beside it.
      place(row[0], 0, half)
    }
  }

  if (options.password) out.encrypt({ userPassword: options.password, ownerPassword: options.password })
  return out.save()
}
