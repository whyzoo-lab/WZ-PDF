import { useState, useEffect } from 'react'
import type { ViewerDoc, DocKind } from '../types/viewerDoc'
import type { ParsedEmail } from '../services/emlParser'
import { detectDocType } from '../utils/detectDocType'

interface UsePdfDocumentReturn {
  pdfDoc: ViewerDoc | null
  numPages: number
  isLoading: boolean
  error: string | null
  kind: DocKind
  /** Set only when kind === 'eml'; pdfDoc stays null in that case. */
  email: ParsedEmail | null
  /** Raw Markdown source; set only when kind === 'md' (pdfDoc stays null). */
  markdown: string | null
}

export function usePdfDocument(file: File | null): UsePdfDocumentReturn {
  const [pdfDoc, setPdfDoc] = useState<ViewerDoc | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<DocKind>('pdf')
  const [email, setEmail] = useState<ParsedEmail | null>(null)
  const [markdown, setMarkdown] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      // Clearing document state when the source file is removed — intentional
      // effect-driven reset, not a cascading-render smell.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPdfDoc(null); setNumPages(0); setIsLoading(false); setError(null); setKind('pdf'); setEmail(null); setMarkdown(null)
      return
    }
    let cancelled = false
    let loadedDoc: ViewerDoc | null = null
    setIsLoading(true); setError(null)

    type Loaded = {
      doc: ViewerDoc | null; kind: DocKind
      email: ParsedEmail | null; markdown: string | null
    }
    file.arrayBuffer().then(async (buffer): Promise<Loaded> => {
      const type = detectDocType(file.name, buffer)
      if (type === 'eml') {
        // Messages skip the page pipeline entirely — see EmailView.
        const { parseEml } = await import('../services/emlParser')
        return { doc: null, kind: 'eml', email: parseEml(buffer), markdown: null }
      }
      if (type === 'md') {
        // Markdown is text, so it needs decoding rather than parsing. Most files
        // are UTF-8; a strict decode that throws is how we notice the ones that
        // aren't (Korean notes are still commonly EUC-KR/CP949).
        let text: string
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
        } catch {
          text = new TextDecoder('euc-kr', { fatal: false }).decode(buffer)
        }
        return { doc: null, kind: 'md', email: null, markdown: text }
      }
      if (type === 'image') {
        // Images are page-like, so they become a one-page ViewerDoc and reuse
        // the whole viewer/annotate/export pipeline unchanged.
        const { createImageViewerDoc } = await import('../services/imageDocAdapter')
        return { doc: await createImageViewerDoc(buffer, file.type), kind: 'image', email: null, markdown: null }
      }
      if (type === 'hwp') {
        const { loadHwp } = await import('../services/hwpEngine')
        const { createHwpViewerDoc } = await import('../services/hwpDocAdapter')
        return { doc: createHwpViewerDoc(await loadHwp(buffer)), kind: 'hwp', email: null, markdown: null }
      }
      // PDF (or unknown → try pdfjs, which errors clearly on non-PDF).
      // pdfjs is imported HERE rather than at module scope so its ~400 KB chunk
      // is fetched on first document open instead of during app startup.
      const [pdfjs, { getPdfWorkerUrl }] = await Promise.all([
        import('pdfjs-dist'),
        import('../services/pdfjsWorker'),
      ])
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = getPdfWorkerUrl()
      }
      const doc = await pdfjs.getDocument({
        data: buffer,
        // Disable CSS @font-face / FontFace API for embedded fonts.
        // pdfjs's FontFace.loaded path can hang in Electron because the browser
        // never auto-triggers font loading for canvas-only contexts (no HTML
        // text elements reference these fonts). With this flag, pdfjs draws
        // glyphs as canvas paths instead — same visual quality for our PNG output.
        disableFontFace: true,
        // Location of pdfjs's WASM image decoders (jbig2 / openjpeg / qcms).
        // pdfjs 5.x decodes JBIG2, CCITT-Fax and JPEG2000 images in WASM; without
        // this it silently drops those images. Korean scanner (MRC) PDFs store
        // their text as CCITT/JBIG2 ImageMasks, so omitting wasmUrl makes the
        // text vanish and only the background layer renders. Bundled offline at
        // public/wasm/ (copied by npm run setup:pdfjs); resolved against the
        // document so it works over http(s) and Electron file://.
        wasmUrl: new URL('wasm/', new URL('./', document.baseURI)).href,
        // Glyph sources for fonts the PDF references but does NOT embed.
        // `disableFontFace: true` above also disables pdfjs's system-font
        // fallback, so a non-embedded font has no glyph source at all and every
        // character renders as a .notdef box (▯) — e.g. the account-number /
        // date / phone fields of a bank passbook printout, while the surrounding
        // embedded-font body text renders fine. standardFontDataUrl supplies the
        // substitute font programs; cMapUrl supplies the predefined CJK CMaps a
        // Korean CID font needs. Bundled offline alongside the wasm decoders.
        standardFontDataUrl: new URL('standard_fonts/', new URL('./', document.baseURI)).href,
        cMapUrl: new URL('cmaps/', new URL('./', document.baseURI)).href,
        cMapPacked: true, // pdfjs ships .bcmap (packed) CMaps
      }).promise
      return { doc: doc as unknown as ViewerDoc, kind: 'pdf', email: null, markdown: null }
    })
      .then(({ doc, kind, email, markdown }) => {
        loadedDoc = doc
        if (cancelled) { doc?.destroy(); return }
        setPdfDoc(doc)
        setNumPages(doc?.numPages ?? 0)
        setKind(kind)
        setEmail(email)
        setMarkdown(markdown)
        setIsLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load document')
        setIsLoading(false)
      })

    return () => {
      cancelled = true
      // Release page caches, worker resources, and decoded images when a
      // document is replaced or the viewer unmounts.
      loadedDoc?.destroy()
      loadedDoc = null
    }
  }, [file])

  return { pdfDoc, numPages, isLoading, error, kind, email, markdown }
}
