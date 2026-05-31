import { useState, useEffect } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PDF_RENDER_SCALE } from '../utils/constants'

/** 썸네일 렌더링 배율 (PDF_RENDER_SCALE * 0.2 = 약 90px 너비) */
const THUMBNAIL_SCALE = 0.2

/**
 * pdfjs로 각 페이지를 작은 JPEG data URL로 렌더링한다.
 * - 페이지를 순서대로 렌더링하며, 각 페이지가 완료될 때마다 배열을 업데이트.
 * - pdfDoc / numPages가 바뀌면 재렌더링.
 * - null = 아직 렌더링 중
 */
export function useThumbnails(
  pdfDoc: PDFDocumentProxy | null,
  numPages: number,
): (string | null)[] {
  const [dataUrls, setDataUrls] = useState<(string | null)[]>([])

  useEffect(() => {
    if (!pdfDoc || numPages === 0) {
      // Clear thumbnails when there's no document — intentional reset.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDataUrls([])
      return
    }

    // Initialize to nulls (loading placeholders).
    setDataUrls(new Array(numPages).fill(null))

    let cancelled = false

    const renderSequentially = async () => {
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        if (cancelled) break
        try {
          const page = await pdfDoc.getPage(pageNum)
          const viewport = page.getViewport({ scale: PDF_RENDER_SCALE * THUMBNAIL_SCALE })
          const canvas = document.createElement('canvas')
          canvas.width  = Math.round(viewport.width)
          canvas.height = Math.round(viewport.height)
          await page.render({ canvas, viewport }).promise
          if (cancelled) break
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
          setDataUrls(prev => {
            const next = [...prev]
            next[pageNum - 1] = dataUrl
            return next
          })
        } catch (err) {
          console.error(`[useThumbnails] page ${pageNum} 렌더링 실패:`, err)
        }
      }
    }

    renderSequentially()
    return () => { cancelled = true }
  }, [pdfDoc, numPages])

  return dataUrls
}
