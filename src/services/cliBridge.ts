/**
 * Renderer half of the console converters `hwp2pdf` and `topdf`, and of the MCP
 * server's `hwp_to_pdf` / `doc_to_pdf`.
 *
 * None of these conversions can run in the main process: HWP renders into a
 * canvas, and Word, PowerPoint, spreadsheets, Markdown and mail are laid out as
 * HTML and printed by Chromium. The converters therefore open the ordinary app
 * page in a hidden window and drive it from here — which also means each file
 * they produce is the same work as saving it from the app: the HWP exporter's
 * selectable text layer and bundled Korean fonts, and the print layouts in
 * officePdfJobs.ts / sheetPdf.ts for the rest.
 *
 * Installed only when the page is loaded with `?cli=1`, and every heavy module
 * is imported inside the call, so a normal launch pays nothing for this.
 */

import { detectDocType } from '../utils/detectDocType'

/** Base64 in fixed-size chunks; one `String.fromCharCode(...bytes)` on a
 *  multi-megabyte PDF overflows the argument limit and throws. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export interface CliBridge {
  /** Load the engine and fonts once, so the first file is not billed for them. */
  warmup(): Promise<void>
  /** Convert one document to PDF and return it as base64. */
  convert(filePath: string): Promise<string>
}

/** Strict UTF-8, else CP949 — the rule the Markdown viewer uses. */
function decodeText(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('euc-kr').decode(bytes)
  }
}

/** Mount `el` where it is laid out like the page, for as long as `work` runs. */
async function mounted<T>(el: HTMLElement, work: () => Promise<T>): Promise<T> {
  document.body.appendChild(el)
  try {
    return await work()
  } finally {
    el.remove()
  }
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function hwpToPdf(bytes: ArrayBuffer): Promise<Uint8Array> {
  const [{ loadHwp }, { createHwpViewerDoc }, { exportHwpToPdf }] = await Promise.all([
    import('./hwpEngine'),
    import('./hwpDocAdapter'),
    import('./pdfExporter'),
  ])
  const doc = createHwpViewerDoc(await loadHwp(bytes))
  try {
    // No annotations: a conversion has no markup to bake in.
    return await exportHwpToPdf(doc, [])
  } finally {
    doc.destroy()
  }
}

async function imageToPdf(bytes: ArrayBuffer): Promise<Uint8Array> {
  const [{ createImageViewerDoc }, { exportHwpToPdf }] = await Promise.all([
    import('./imageDocAdapter'),
    import('./pdfExporter'),
  ])
  const doc = await createImageViewerDoc(bytes, '')
  try {
    return await exportHwpToPdf(doc, [])
  } finally {
    doc.destroy()
  }
}

async function docxToPdf(bytes: ArrayBuffer): Promise<Uint8Array> {
  const [{ renderDocx }, { paginateDocx }, { docxPdfJob }, { officeJobToPdf }] = await Promise.all([
    import('./docxDoc'),
    import('./docxPaginate'),
    import('./officePdfJobs'),
    import('./officePdf'),
  ])
  const doc = await renderDocx(bytes)
  const body = document.createElement('div')
  body.innerHTML = `<style>${doc.css}</style><div class="wz-docx-host">${doc.html}</div>`
  try {
    return await mounted(body, async () => {
      // Pages are split by measuring them, so this needs the live layout.
      const wrapper = body.querySelector<HTMLElement>('.wz-docx-wrapper')
      if (wrapper) paginateDocx(wrapper)
      return officeJobToPdf(docxPdfJob(body))
    })
  } finally {
    doc.objectUrls.forEach(u => URL.revokeObjectURL(u))
  }
}

async function pptxToPdf(bytes: ArrayBuffer): Promise<Uint8Array> {
  const [pptx, { pptxPdfJob }, { officeJobToPdf }] = await Promise.all([
    import('./pptxDoc'),
    import('./officePdfJobs'),
    import('./officePdf'),
  ])
  const pres = await pptx.loadPptx(bytes)
  // Links in a converted file are never followed; nothing to navigate to.
  const ctx = pptx.createRenderContext(() => undefined)
  try {
    const slides = pres.slides.map((s, i) => {
      try {
        return { element: pptx.renderOneSlide(pres, i, ctx).element, hidden: !!s.hidden }
      } catch (err) {
        console.error(`Slide ${i + 1} failed to render:`, err)
        return { element: null, hidden: !!s.hidden }
      }
    })
    const holder = document.createElement('div')
    for (const s of slides) if (s.element) holder.appendChild(s.element)
    return await mounted(holder, () => officeJobToPdf(pptxPdfJob({ width: pres.width, height: pres.height }, slides)))
  } finally {
    pptx.disposeRenderContext(ctx)
  }
}

async function sheetToPdf(bytes: ArrayBuffer, name: string): Promise<Uint8Array> {
  const [{ loadWorkbook, layoutSheet }, { sheetPdfJob }, { officeJobToPdf, mergePdfs }] = await Promise.all([
    import('./sheetDoc'),
    import('./sheetPdf'),
    import('./officePdf'),
  ])
  const { workbook, format } = await loadWorkbook(bytes, name)
  // Every visible sheet with anything on it, in tab order — a converted
  // workbook should hold all of it, not just the tab that happened to be open.
  const sheets = workbook.sheets.filter(s => !s.hidden && !s.veryHidden && !layoutSheet(s, workbook).empty)
  const parts: Uint8Array[] = []
  for (const sheet of sheets.length ? sheets : workbook.sheets.slice(0, 1)) {
    parts.push(await officeJobToPdf(sheetPdfJob(sheet, workbook, format)))
  }
  return mergePdfs(parts)
}

/** Markdown and mail: their HTML, typeset the way the app prints them. */
async function flowToPdf(article: HTMLElement): Promise<Uint8Array> {
  const [{ flowPdfJob }, { officeJobToPdf }] = await Promise.all([
    import('./officePdfJobs'),
    import('./officePdf'),
  ])
  article.style.fontSize = '15px'
  return mounted(article, () => officeJobToPdf(flowPdfJob(article)))
}

async function markdownToPdf(bytes: ArrayBuffer, name: string): Promise<Uint8Array> {
  const { renderMarkdown } = await import('./markdownDoc')
  const doc = await renderMarkdown(decodeText(bytes))
  const article = document.createElement('article')
  article.className = 'bg-white text-gray-900'
  article.innerHTML = (doc.title ? '' : `<h1 class="text-xl font-semibold mb-4">${escapeHtml(name)}</h1>`)
    + `<div class="wz-md-body leading-7">${doc.html}</div>`
  return flowToPdf(article)
}

async function emailToPdf(bytes: ArrayBuffer): Promise<Uint8Array> {
  const [{ parseEml }, { renderEmailHtml, renderEmailText }] = await Promise.all([
    import('./emlParser'),
    import('./emailHtml'),
  ])
  const mail = parseEml(bytes)
  // Remote images stay withheld, as in the viewer: converting a message must
  // not tell its sender it was opened.
  const body = mail.html ? renderEmailHtml(mail.html).html : mail.text ? renderEmailText(mail.text) : ''
  const field = (label: string, value: string) =>
    value ? `<div><span style="color:#6b7280">${label}</span> ${escapeHtml(value)}</div>` : ''
  const article = document.createElement('article')
  article.className = 'bg-white text-gray-900'
  article.innerHTML = `<header style="border-bottom:1px solid #e5e7eb;padding-bottom:12px;margin-bottom:16px">
      <h1 style="font-size:1.4em;font-weight:600;margin:0 0 8px">${escapeHtml(mail.subject || '')}</h1>
      ${field('From', mail.from)}${field('To', mail.to)}${field('Cc', mail.cc)}${field('Date', mail.date)}
      ${mail.attachments.length ? field('Attachments', mail.attachments.map(a => a.filename).join(', ')) : ''}
    </header><div>${body}</div>`
  return flowToPdf(article)
}

/** Any document the app opens, as PDF bytes. */
export async function documentToPdf(bytes: ArrayBuffer, name: string): Promise<Uint8Array> {
  switch (detectDocType(name, bytes)) {
    case 'pdf': return new Uint8Array(bytes)
    case 'hwp': return hwpToPdf(bytes)
    case 'image': return imageToPdf(bytes)
    case 'docx': return docxToPdf(bytes)
    case 'pptx': return pptxToPdf(bytes)
    case 'sheet': return sheetToPdf(bytes, name)
    case 'md': return markdownToPdf(bytes, name.replace(/\.[^.]+$/, ''))
    case 'eml': return emailToPdf(bytes)
    default: throw new Error(`not a document WZ PDF opens: ${name}`)
  }
}

export function installCliBridge(): void {
  const bridge: CliBridge = {
    async warmup(): Promise<void> {
      // The Korean fallback fonts alone are ~12 MB, and the WASM engine and
      // pdf-lib arrive as their own chunks. Paid once, up front, rather than
      // inside the first file's conversion budget — which is how a perfectly
      // good document ended up reported as a timeout.
      const [{ ensureKoreanFonts }] = await Promise.all([
        import('./hwpFonts'),
        import('./hwpEngine'),
        import('./hwpDocAdapter'),
        import('./pdfExporter'),
      ])
      await ensureKoreanFonts()
    },

    async convert(filePath: string): Promise<string> {
      const bytes = await window.electronAPI!.readFile(filePath)
      const name = filePath.split(/[\\/]/).pop() ?? filePath
      return toBase64(await documentToPdf(bytes, name))
    },
  }
  ;(window as unknown as { __wzCli?: CliBridge }).__wzCli = bridge
}
