import { useEffect, useRef, useState, useCallback } from 'react'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ViewerDoc } from '../../types/viewerDoc'

export interface TextEditCommit {
  /** New text content typed by the user. */
  text: string
  /** Bounding box of the original span in PDF points (page-local, top-left origin). */
  x: number
  y: number
  width: number
  height: number
  /** Estimated font size in PDF points (matches the original glyph height). */
  fontSize: number
}

/** A search hit on this page, expressed as a span (text-item) index range. */
export interface TextLayerHighlight {
  itemStart: number
  itemEnd: number
  active: boolean
}

interface PdfTextLayerProps {
  pdfDoc: ViewerDoc
  pageNumber: number
  /** Effective display scale (PDF_RENDER_SCALE * zoom). */
  scale: number
  rotation: number
  /** Display width of the underlying canvas in CSS pixels. */
  width: number
  /** Display height of the underlying canvas in CSS pixels. */
  height: number
  /** When provided, double-clicking a text span opens an inline editor; on
   *  confirmation this callback fires with the new text and original bounds
   *  (in PDF points). Omit to keep the layer read-only (text selection only). */
  onEditCommit?: (edit: TextEditCommit) => void
  /** Search hits to highlight on this page (span backgrounds). */
  highlights?: TextLayerHighlight[]
}

interface EditState {
  /** Bounds of the original span in CSS pixels, relative to the layer container. */
  cssX: number
  cssY: number
  cssW: number
  cssH: number
  /** Initial text content of the span. */
  original: string
}

/**
 * Overlay div populated with pdfjs's `TextLayer` so PDF text becomes
 * selectable / copyable. The spans rendered inside are invisible (transparent
 * fill) and aligned exactly with the painted glyphs on the Konva canvas
 * underneath — selecting them in the browser gives the user real text.
 *
 * Editor mode: double-clicking a text span swaps it for an inline `<input>`
 * positioned exactly over the span. Enter commits, Escape cancels, blur
 * commits. Coordinates are converted from CSS pixels to PDF points before
 * the commit callback fires.
 */
export function PdfTextLayer({
  pdfDoc, pageNumber, scale, rotation, width, height, onEditCommit, highlights,
}: PdfTextLayerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<EditState | null>(null)
  // Bumped after each TextLayer render so the highlight effect re-applies
  // once the spans actually exist in the DOM.
  const [renderNonce, setRenderNonce] = useState(0)

  // ── Render the pdfjs TextLayer ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const el = ref.current
    if (!el) return

    // Clear any previous render (rotation / scale changes re-render).
    el.replaceChildren()

    ;(async () => {
      try {
        // Cast to PDFDocumentProxy for TextLayer — this path is PDF-only;
        // HWP pages return empty text content and the TextLayer is not rendered.
        const pdfjsDoc = pdfDoc as unknown as PDFDocumentProxy
        const page = await pdfjsDoc.getPage(pageNumber)
        if (cancelled) return
        const textContent = await page.getTextContent()
        if (cancelled) return
        const viewport = page.getViewport({ scale, rotation })

        const layer = new TextLayer({
          textContentSource: textContent,
          container: el,
          viewport,
        })
        await layer.render()
        if (!cancelled) setRenderNonce(n => n + 1)
      } catch (err) {
        // Text layer is a nice-to-have — never crash the viewer if it fails.
        console.warn(`[PdfTextLayer] page ${pageNumber} render failed:`, err)
      }
    })()

    return () => { cancelled = true }
  }, [pdfDoc, pageNumber, scale, rotation])

  // ── Search highlights ─────────────────────────────────────────────────────
  // pdfjs renders one <span> per text item, in order, so item index maps to
  // span index. We background the matched spans (text is transparent, so the
  // background shows as a highlight aligned with the glyphs) and scroll the
  // active match into view.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const spans = el.querySelectorAll<HTMLElement>(':scope > span')

    // Clear any previous highlight classes.
    spans.forEach(s => s.classList.remove('wz-search-hl', 'wz-search-hl-active'))
    if (!highlights || highlights.length === 0) return

    let activeSpan: HTMLElement | null = null
    for (const h of highlights) {
      for (let i = h.itemStart; i <= h.itemEnd && i < spans.length; i++) {
        const span = spans[i]
        if (!span) continue
        span.classList.add('wz-search-hl')
        if (h.active) {
          span.classList.add('wz-search-hl-active')
          activeSpan ??= span
        }
      }
    }
    // Bring the active match into view (the inner PDF scroll container scrolls;
    // App's scroll-pin guard absorbs any stray window scroll).
    activeSpan?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlights, renderNonce])

  // ── Editor mode: double-click a span to start editing ─────────────────────
  useEffect(() => {
    if (!onEditCommit) return
    const el = ref.current
    if (!el) return

    const handler = (e: MouseEvent) => {
      const tgt = e.target as HTMLElement | null
      if (!tgt || tgt.tagName !== 'SPAN' || !el.contains(tgt)) return
      e.preventDefault()
      e.stopPropagation()

      const cRect = el.getBoundingClientRect()
      const sRect = tgt.getBoundingClientRect()
      setEditing({
        cssX: sRect.left - cRect.left,
        cssY: sRect.top  - cRect.top,
        cssW: sRect.width,
        cssH: sRect.height,
        original: tgt.textContent ?? '',
      })
    }
    el.addEventListener('dblclick', handler)
    return () => el.removeEventListener('dblclick', handler)
  }, [onEditCommit])

  // Auto-focus + select all when the inline editor opens.
  useEffect(() => {
    if (!editing) return
    const id = window.requestAnimationFrame(() => {
      // preventScroll: focusing an element near the viewport edge otherwise
      // makes the browser scrollIntoView() it, scrolling overflow-hidden
      // ancestors (root/main) and pushing the toolbar off-screen.
      inputRef.current?.focus({ preventScroll: true })
      inputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(id)
  }, [editing])

  const commit = useCallback(() => {
    if (!editing || !onEditCommit) {
      setEditing(null)
      return
    }
    const newText = inputRef.current?.value ?? ''
    if (newText && newText !== editing.original) {
      onEditCommit({
        text: newText,
        x: editing.cssX / scale,
        y: editing.cssY / scale,
        width: editing.cssW / scale,
        height: editing.cssH / scale,
        fontSize: (editing.cssH * 0.85) / scale,  // empirical — span height includes leading
      })
    }
    setEditing(null)
  }, [editing, onEditCommit, scale])

  const cancel = useCallback(() => setEditing(null), [])

  return (
    <div
      ref={ref}
      className="pdf-text-layer no-print"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width,
        height,
        overflow: 'hidden',
        // Wrapper doesn't catch events; the spans inside opt in via CSS.
        pointerEvents: 'none',
        // pdfjs's TextLayer overwrites style.width/height via setLayerDimensions
        // using `calc(round(down, var(--total-scale-factor) * pageWidth px, var(--scale-round-x)))`.
        // These vars are required or the dimensions resolve to invalid values.
        // We use a sub-pixel round step (not 1px) so the text-layer box matches
        // the Konva canvas *exactly* — a 1px step left the box up to ~1px
        // narrower/shorter, and `overflow:hidden` then clipped edge glyphs,
        // making text near the right/bottom margin unselectable at some zooms.
        ['--total-scale-factor' as never]: String(scale),
        ['--scale-round-x' as never]: '0.001px',
        ['--scale-round-y' as never]: '0.001px',
      }}
    >
      {editing && (
        <input
          ref={inputRef}
          type="text"
          defaultValue={editing.original}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            else if (e.key === 'Escape') { e.preventDefault(); cancel() }
          }}
          onBlur={commit}
          spellCheck={false}
          // Stop blur from triggering when the input is interacted with internally.
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: editing.cssX,
            top: editing.cssY,
            width: Math.max(editing.cssW, 80),
            height: Math.max(editing.cssH, 24),
            // Match the original glyph size as closely as we can.
            fontSize: editing.cssH * 0.9,
            lineHeight: 1,
            padding: '1px 3px',
            margin: 0,
            border: '2px solid #38bdf8',
            borderRadius: 2,
            background: 'rgba(255,255,255,0.98)',
            color: '#000',
            outline: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            pointerEvents: 'auto',
            fontFamily: 'sans-serif',
            zIndex: 10,
          }}
        />
      )}
    </div>
  )
}
