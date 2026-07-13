import { useState, useEffect } from 'react'
import type { ViewerDoc, DocKind } from '../types/viewerDoc'
import type { OcrWord } from '../types/ocr'

/**
 * HWP native text layer. HWP pages have no pdfjs text layer, but rhwp exposes
 * positioned text runs. This fetches them (as OcrWord-shaped items) so the same
 * selectable overlay OCR uses makes HWP text selectable/copyable with no OCR
 * pass. PDF and image-only HWP pages return no words and are unaffected.
 */
export function useHwpPageText(pdfDoc: ViewerDoc, pageNumber: number, kind: DocKind) {
  const [hwpWords, setHwpWords] = useState<OcrWord[] | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset on dep change
    if (kind !== 'hwp' || !pdfDoc.getPageText) { setHwpWords(null); return }
    let cancelled = false
    pdfDoc.getPageText(pageNumber)
      .then(runs => {
        if (cancelled) return
        setHwpWords(runs.map(r => ({
          text: r.text, score: 1, x: r.x, y: r.y, width: r.width, height: r.height, rotation: 0,
        })))
      })
      .catch(() => { if (!cancelled) setHwpWords([]) })
    return () => { cancelled = true }
  }, [pdfDoc, pageNumber, kind])

  const hasHwpText = !!(hwpWords && hwpWords.length > 0)
  return { hwpWords, hasHwpText }
}
