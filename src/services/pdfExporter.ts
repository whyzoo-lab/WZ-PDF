import { PDFDocument, PDFFont, PDFPage, rgb, degrees, StandardFonts } from '@cantoo/pdf-lib'
import { loadPdfForWriting } from './pdfLoad'
import { BASELINE_RATIO, type PlacedRun } from './ocrTextLayer'
import type { OcrWord } from '../types/ocr'
import type { Annotation } from '../types/annotation'
import { annotationsForPage, isVolatile } from '../types/annotation'
import { drawAnnotations } from './annotationCanvas'
import { toPdfLibY, hexToRgb } from '../utils/coordinates'
import type { ViewerDoc } from '../types/viewerDoc'

/** Exported for unit testing */
export function base64ToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ── Korean font (lazy) ──────────────────────────────────────────────────────
// Helvetica covers only Latin-1; any CJK text drawn through it would silently
// fall back to glyph 0 (.notdef) and look broken in the exported PDF.
// We ship Noto Sans KR (OFL) and embed it via fontkit on demand
// (fontkit v2, see ./fontkit — not @pdf-lib/fontkit, which drops glyphs).
//
// Fetched at most once per session and cached as a Uint8Array so repeated
// exports don't re-download. Vite serves it from /fonts/.

let _koFontBytes: Uint8Array | null = null
async function loadKoreanFontBytes(): Promise<Uint8Array> {
  if (_koFontBytes) return _koFontBytes
  // Vite sets `base: './'`, so a leading-slash URL resolves correctly under
  // any deployment path (root, sub-path, file://).
  const res = await fetch(new URL('./fonts/NotoSansKR-Regular.otf', document.baseURI))
  if (!res.ok) throw new Error(`Failed to load Korean font: ${res.status}`)
  _koFontBytes = new Uint8Array(await res.arrayBuffer())
  return _koFontBytes
}

/** Remove C0/C1 control characters, which have no glyph in any font. */
function stripControlChars(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    out += (c < 0x20 || c === 0x7f) ? ' ' : ch
  }
  return out
}

/** True if any character is outside the Latin-1 supplement block — i.e. needs the CJK font. */
function needsKoreanFont(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0xFF) return true
  }
  return false
}

/**
 * A canvas as JPEG bytes. `toBlob` encodes off the main thread; `toDataURL`
 * blocked it, then the base64 had to be decoded back by hand — twice the memory
 * for every page of a long document. Falls back where `toBlob` is missing
 * (jsdom).
 */
/** PNG keeps transparency, which JPEG turns black. */
async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = typeof canvas.toBlob === 'function'
    ? await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    : null
  if (blob) return new Uint8Array(await blob.arrayBuffer())
  return base64ToUint8Array(canvas.toDataURL('image/png'))
}

async function canvasJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = typeof canvas.toBlob === 'function'
    ? await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    : null
  if (blob) return new Uint8Array(await blob.arrayBuffer())
  return base64ToUint8Array(canvas.toDataURL('image/jpeg', quality))
}

/** Noto Sans KR, embedded once per document and subsetted to the glyphs used. */
async function embedTextFont(pdfDoc: PDFDocument): Promise<PDFFont> {
  const { loadFontkit } = await import('./fontkit')
  pdfDoc.registerFontkit(await loadFontkit())
  // Subset, or the whole CJK face would be embedded once per export.
  return pdfDoc.embedFont(await loadKoreanFontBytes(), { subset: true })
}

/**
 * Write text that can be selected, copied and searched but is never painted —
 * the technique OCR layers use, over pixels that already show the words.
 *
 * Each run is sized from its measured **width**, not its height: the text is
 * invisible, so vertical distortion never shows, while matching the width keeps
 * selection highlights aligned with the glyphs underneath.
 */
function drawInvisibleRuns(page: PDFPage, font: PDFFont, runs: PlacedRun[]): void {
  for (const run of runs) {
    // Drop control characters — they have no glyph and abort encoding.
    const text = stripControlChars(run.text).trim()
    if (!text || run.height <= 0) continue
    try {
      const unit = font.widthOfTextAtSize(text, 100)
      const size = unit > 0
        ? Math.min(Math.max((run.width / unit) * 100, 1), run.height * 2)
        : run.height * 0.8
      page.drawText(text, {
        x: run.x,
        y: run.y,
        size,
        font,
        rotate: degrees(run.angle),
        opacity: 0, // present and selectable, but never painted
      })
    } catch {
      // A glyph the font lacks (emoji, rare CJK) must not fail the export —
      // that run simply stays unselectable.
    }
  }
}

/**
 * 요청이 있었으면 문서를 암호로 잠근다.
 *
 * owner 암호를 user 암호와 같은 값으로 함께 건다. owner 암호를 비워 두면 어떤
 * 도구든 제한 없이 다시 저장할 수 있어서, "암호를 걸었다"는 말이 첫 번째 왕복까지만
 * 참이 된다. 알고리즘은 라이브러리 기본값인 AES-256을 그대로 쓴다.
 */
function lock(pdfDoc: PDFDocument, password?: string): void {
  if (!password) return
  pdfDoc.encrypt({ userPassword: password, ownerPassword: password })
}

/** How the saved file relates to the document that was opened. */
export interface PdfSaveOptions {
  /** Password that opens `originalBytes`, when the source document is encrypted. */
  sourcePassword?: string
  /**
   * Password to put on the saved file. Leaving it out saves an unlocked file —
   * which is how removing a password works: open the document with the one it
   * has, save it without one.
   */
  password?: string
}

export async function exportPdf(
  originalBytes: ArrayBuffer,
  annotations: Annotation[],
  save: PdfSaveOptions = {},
  /**
   * Recognized text to keep, by page (see `placeOcrWords`). OCR lives only in
   * the app's memory; without this a scanned document came back out of Save as
   * the same image-only PDF it went in as, and the recognition was lost.
   */
  textLayer?: Map<number, PlacedRun[]>,
): Promise<Blob> {
  const { sourcePassword, password } = save
  const pdfDoc = await loadPdfForWriting(originalBytes, sourcePassword)
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)

  // Noto Sans KR, embedded at most once and only when something needs it: a
  // Korean watermark or text edit, or OCR text. One embedding for all of them
  // — two would put the font in the file twice.
  let koFont: PDFFont | null = null
  const koreanFont = async () => (koFont ??= await embedTextFont(pdfDoc))
  const koNeeded = annotations.some(a =>
    (a.type === 'watermark' && needsKoreanFont(a.text)) ||
    (a.type === 'textEdit' && needsKoreanFont(a.text)),
  )
  if (koNeeded) await koreanFont()
  const fontFor = (text: string): PDFFont =>
    needsKoreanFont(text) && koFont ? koFont : helvetica

  const pages = pdfDoc.getPages()

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx]
    const pageNum = pageIdx + 1
    const { width: pdfPageWidth, height: pdfPageHeight } = page.getSize()

    const pageAnnotations = annotationsForPage(annotations, pageNum)

    for (const annotation of pageAnnotations) {
      if (annotation.type === 'stamp' || annotation.type === 'signature') {
        // Stored coords are already PDF points (screen pixels / effectiveZoom, where effectiveZoom = PDF_RENDER_SCALE * zoom)
        const pdfX = annotation.x
        const pdfYTop = annotation.y
        const pdfW = annotation.width
        const pdfH = annotation.height
        const pdfLibY = toPdfLibY(pdfYTop, pdfH, pdfPageHeight)

        const bytes = base64ToUint8Array(annotation.src)
        try {
          const image = await pdfDoc.embedPng(bytes)
          page.drawImage(image, {
            x: pdfX,
            y: pdfLibY,
            width: pdfW,
            height: pdfH,
            rotate: degrees(annotation.rotation),
          })
        } catch (err) {
          console.error(`Failed to embed annotation image (id: ${annotation.id}):`, err)
        }
      }

      if (annotation.type === 'watermark') {
        const wm = annotation
        const [r, g, b] = hexToRgb(wm.color)
        const font = fontFor(wm.text)
        const textWidth = font.widthOfTextAtSize(wm.text, wm.fontSize)
        page.drawText(wm.text, {
          x: (pdfPageWidth - textWidth) / 2,
          y: pdfPageHeight / 2 - wm.fontSize / 2,
          size: wm.fontSize,
          font,
          color: rgb(r, g, b),
          opacity: wm.opacity,
          rotate: degrees(wm.rotation),
        })
      }

      if (annotation.type === 'textEdit') {
        // Cover the original text with a filled rectangle, then draw the new
        // text on top. Coords stored top-left in PDF points; pdf-lib uses
        // bottom-left so we convert via toPdfLibY.
        const pdfLibY = toPdfLibY(annotation.y, annotation.height, pdfPageHeight)
        const [br, bg, bb] = hexToRgb(annotation.background)
        page.drawRectangle({
          x: annotation.x,
          y: pdfLibY,
          width: annotation.width,
          height: annotation.height,
          color: rgb(br, bg, bb),
        })
        const [fr, fg, fb] = hexToRgb(annotation.color)
        // Draw text baselined inside the box: pdf-lib's `y` is the baseline,
        // so offset upward by a fraction of fontSize to roughly vertically
        // centre. Empirical 0.2 works well for both Helvetica and Noto Sans KR.
        page.drawText(annotation.text, {
          x: annotation.x + 2,
          y: pdfLibY + annotation.height * 0.2,
          size: annotation.fontSize,
          font: fontFor(annotation.text),
          color: rgb(fr, fg, fb),
        })
      }
    }
  }

  if (textLayer && textLayer.size > 0) {
    const font = await koreanFont()
    for (const [pageNum, runs] of textLayer) {
      const page = pages[pageNum - 1]
      if (page) drawInvisibleRuns(page, font, runs)
    }
  }

  lock(pdfDoc, password)
  const pdfBytes = await pdfDoc.save()
  // pdfBytes is a Uint8Array; BlobPart accepts it, but its backing buffer may
  // be a SharedArrayBuffer in some TS lib configs — cast to a plain Uint8Array
  // view to satisfy the BlobPart type without `any`.
  return new Blob([pdfBytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}

/**
 * Build a fresh PDF from a rendered HWP document by compositing each page
 * canvas with its non-volatile annotations.
 *
 * Because HWP bytes are not a PDF we can't load them into pdf-lib directly.
 * Instead we render every page via `getOrRenderPage`, draw the canvas as a
 * JPEG into a pdf-lib page sized to the canvas, and return the resulting bytes.
 * This doubles as an HWP → PDF converter.
 *
 * Volatile annotations (pen / rectangle) are intentionally skipped to match
 * the existing PDF export semantics.
 */
export async function exportHwpToPdf(
  doc: ViewerDoc,
  annotations: Annotation[],
  password?: string,
  /**
   * Words OCR recognized, by page. Used where the source has no text of its
   * own — an image, or a scanned page inside a HWP — so the recognition
   * survives the save instead of leaving an image-only PDF.
   */
  ocrWords?: Map<number, OcrWord[]>,
  /** Only these pages, in this order ("save selection"); all of them when absent. */
  pageNums?: number[],
): Promise<Uint8Array> {
  const { getOrRenderPage } = await import('./pageRender')

  const pdfDoc = await PDFDocument.create()
  // Embedded on first use — a document with no extractable text pays nothing.
  let textFont: PDFFont | null = null

  const order = pageNums ?? Array.from({ length: doc.numPages }, (_, i) => i + 1)
  for (const pageNum of order) {
    const { canvas } = await getOrRenderPage(doc, pageNum)

    // The page in PDF points is the page's own size at scale 1 — not the
    // raster's size: a very large picture's raster is capped (see
    // imageDocAdapter clampRaster) and would have shrunk the page with it.
    // Known limitation: those are scale-1 pixel sizes used directly as points,
    // with no 96→72 DPI conversion; proportions are right, print size may differ.
    const natural = (await doc.getPage(pageNum)).getViewport({ scale: 1 })
    const pageWidth = natural.width
    const pageHeight = natural.height
    const scale = canvas.width / pageWidth   // raster pixels per point
    const page = pdfDoc.addPage([pageWidth, pageHeight])
    const full = { x: 0, y: 0, width: pageWidth, height: pageHeight }
    const marked = annotationsForPage(annotations, pageNum).some(a => !isVolatile(a))

    // A JPEG or PNG picture goes in as the file it is: no second JPEG pass over
    // a photo (smaller and sharper), and a PNG keeps its transparency. Marks go
    // on top as a transparent layer of their own.
    const encoded = await doc.images?.encoded(pageNum).catch(() => null) ?? null
    let placed = false
    if (encoded) {
      try {
        const picture = encoded.type === 'jpeg' ? await pdfDoc.embedJpg(encoded.bytes) : await pdfDoc.embedPng(encoded.bytes)
        page.drawImage(picture, full)
        placed = true
      } catch { /* a variant pdf-lib cannot read: drawn from the raster below */ }
    }
    if (placed) {
      if (marked) {
        const overlay = document.createElement('canvas')
        overlay.width = canvas.width
        overlay.height = canvas.height
        const octx = overlay.getContext('2d')
        if (octx) {
          await drawAnnotations(octx, annotations, pageNum, scale)
          page.drawImage(await pdfDoc.embedPng(await canvasPng(overlay)), full)
        }
      }
    } else {
      // Composite non-volatile annotations onto a scratch canvas so the
      // exported page contains stamps/signatures/watermarks/textEdits just like
      // print does. `compositedCanvas` stays as `canvas` when 2d context is
      // unavailable (e.g. jsdom in tests).
      let compositedCanvas: HTMLCanvasElement = canvas
      const out = document.createElement('canvas')
      out.width = canvas.width
      out.height = canvas.height
      const ctx = out.getContext('2d')
      if (ctx) {
        compositedCanvas = out
        ctx.drawImage(canvas, 0, 0)
        await drawAnnotations(ctx, annotations, pageNum, scale)
      }
      // JPEG for rendered document pages; PNG where a picture may be
      // transparent — JPEG has no alpha and paints those pixels black.
      const image = doc.images?.mayHaveAlpha(pageNum)
        ? await pdfDoc.embedPng(await canvasPng(compositedCanvas))
        : await pdfDoc.embedJpg(await canvasJpeg(compositedCanvas, 0.92))
      page.drawImage(image, full)
    }

    // ── Selectable text layer ────────────────────────────────────────────────
    // The picture alone would make an image-only PDF: it looks right but no
    // text can be selected, copied or searched. rhwp gives us the real text with
    // its geometry, so each run is drawn invisibly on top of the pixels it
    // corresponds to. Where the source has no text (an image, a scanned page),
    // whatever OCR recognized takes its place. Both are top-down boxes in page
    // points like the canvas; PDF is bottom-up.
    const own = (await doc.getPageText?.(pageNum)) ?? []
    const boxes = own.length > 0 ? own : (ocrWords?.get(pageNum) ?? [])
    if (boxes.length > 0) {
      textFont ??= await embedTextFont(pdfDoc)
      drawInvisibleRuns(page, textFont, boxes.map(b => ({
        text: b.text,
        x: b.x,
        y: pageHeight - b.y - b.height * BASELINE_RATIO,
        width: b.width,
        height: b.height,
        angle: 0,
      })))
    }
  }

  lock(pdfDoc, password)
  return pdfDoc.save()
}
