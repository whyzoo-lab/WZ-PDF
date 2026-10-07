/**
 * The print layouts a PDF of each reflowing format is made from.
 *
 * Shared by the views (Save as PDF, print) and the headless converter behind
 * `--topdf` and the MCP server's `doc_to_pdf` (cliBridge), so a document
 * converted without a window comes out exactly like one saved from the app.
 * Each builder returns a `PdfJob` for services/officePdf.ts to print. The
 * spreadsheet one is services/sheetPdf.ts, kept apart so Word and PowerPoint
 * do not pull the spreadsheet reader into their chunks.
 */

import { cloneForPrint, type PdfJob } from './officePdf'
import { FLOW_PRINT_ATTR } from './htmlPrint'

/** Word's pages inside a rendered docx-preview body. */
export const DOCX_PAGE_SELECTOR = '.wz-docx-wrapper > section.wz-docx'

/** A page's own size in px — computed style, unaffected by a view's zoom. */
export function docxPageSize(section: HTMLElement): { w: number; h: number } {
  const cs = getComputedStyle(section)
  return { w: parseFloat(cs.width) || 794, h: parseFloat(cs.height) || 1123 }
}

/**
 * Word: each page printed on paper of its own size (a landscape section stays
 * landscape) through a named @page, with no margin of our own — the page
 * already carries Word's margins, header and footer.
 *
 * `body` is the live element holding docx-preview's style and pages, already
 * paginated (services/docxPaginate.ts).
 */
export function docxPdfJob(body: HTMLElement): PdfJob {
  const live = Array.from(body.querySelectorAll<HTMLElement>(DOCX_PAGE_SELECTOR))
  const copy = cloneForPrint(body)
  copy.style.zoom = ''
  const rules: string[] = []
  Array.from(copy.querySelectorAll<HTMLElement>(DOCX_PAGE_SELECTOR)).forEach((section, i) => {
    const { w, h } = live[i] ? docxPageSize(live[i]) : { w: 794, h: 1123 }
    section.setAttribute('data-wz-pdf-page', String(i))
    rules.push(`@page wzp${i} { size: ${w}px ${h}px; margin: 0; }`)
    rules.push(`[data-wz-pdf-page="${i}"] { page: wzp${i}; }`)
  })
  return {
    pieces: 1,
    piece: () => copy,
    css: `${rules.join('\n')}
      #wz-print-root .wz-docx-wrapper { display: block !important; padding: 0 !important; background: none !important; }
      #wz-print-root .wz-docx-wrapper > section.wz-docx { margin: 0 !important; box-shadow: none !important; break-after: page; }
      #wz-print-root .wz-docx-wrapper > section.wz-docx:last-child { break-after: auto; }`,
  }
}

/**
 * PowerPoint: one slide per page at the slide's size. Hidden slides are left
 * out, as PowerPoint's own "Save as PDF" does.
 */
export function pptxPdfJob(
  size: { width: number; height: number },
  slides: Array<{ element: HTMLElement | null; hidden: boolean }>,
): PdfJob {
  const sheet = document.createElement('div')
  sheet.className = 'wz-pdf-slides'
  sheet.style.setProperty('--wz-slide-scale', '1')
  for (const slide of slides) {
    if (slide.hidden || !slide.element) continue
    const page = document.createElement('div')
    page.className = 'wz-pdf-slide'
    page.appendChild(cloneForPrint(slide.element))
    sheet.appendChild(page)
  }
  return {
    pieces: 1,
    piece: () => sheet,
    css: `@page { size: ${size.width}px ${size.height}px; margin: 0; }
      .wz-pdf-slide { position: relative; overflow: hidden; width: ${size.width}px; height: ${size.height}px; break-after: page; }
      .wz-pdf-slide:last-child { break-after: auto; }`,
  }
}

/**
 * Markdown or mail: the text on A4 with the margins printing uses, broken
 * across pages by the browser — the same layout as printing it from the app
 * (services/htmlPrint.ts), so the print stylesheet's reflowing-document rules
 * apply.
 */
export function flowPdfJob(body: HTMLElement): PdfJob {
  const copy = cloneForPrint(body)
  copy.setAttribute(FLOW_PRINT_ATTR, '')
  return {
    pieces: 1,
    flow: true,
    piece: () => copy,
    css: '@page { size: A4; margin: 14mm; }',
  }
}
