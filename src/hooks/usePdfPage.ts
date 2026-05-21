import { useState, useEffect } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PDF_RENDER_SCALE } from '../utils/constants'

export interface PageData {
  imageUrl: string
  width: number   // rendered pixel width  (= PDF points * PDF_RENDER_SCALE)
  height: number  // rendered pixel height
}

interface UsePdfPageReturn {
  pageData: PageData | null
  isLoading: boolean
}

export function usePdfPage(
  pdfDoc: PDFDocumentProxy | null,
  pageNumber: number,
): UsePdfPageReturn {
  const [pageData, setPageData] = useState<PageData | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!pdfDoc) { setPageData(null); return }

    let cancelled = false
    setIsLoading(true)

    pdfDoc.getPage(pageNumber).then(page => {
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')!
      return page.render({ canvasContext: ctx, viewport }).promise.then(() => {
        if (cancelled) return
        setPageData({
          imageUrl: canvas.toDataURL('image/png'),
          width: viewport.width,
          height: viewport.height,
        })
        setIsLoading(false)
      })
    })

    return () => { cancelled = true }
  }, [pdfDoc, pageNumber])

  return { pageData, isLoading }
}
