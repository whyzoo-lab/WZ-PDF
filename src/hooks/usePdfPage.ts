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

    console.log(`[usePdfPage] starting render for page ${pageNumber}`)

    pdfDoc.getPage(pageNumber).then(page => {
      console.log(`[usePdfPage] got page ${pageNumber}, creating canvas`)
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error(`canvas.getContext('2d') returned null for page ${pageNumber}`)
      }
      console.log(`[usePdfPage] calling page.render() for page ${pageNumber}`)
      const renderTask = page.render({ canvas, viewport })
      console.log(`[usePdfPage] render task created for page ${pageNumber}, awaiting promise`)
      return renderTask.promise.then(() => {
        console.log(`[usePdfPage] render complete for page ${pageNumber}`)
        if (cancelled) return
        setPageData({
          imageUrl: canvas.toDataURL('image/png'),
          width: viewport.width,
          height: viewport.height,
        })
        setIsLoading(false)
      })
    }).catch(err => {
      if (cancelled) return
      console.error(`[usePdfPage] Failed to render PDF page ${pageNumber}:`, err)
      setIsLoading(false)
    })

    return () => { cancelled = true }
  }, [pdfDoc, pageNumber])

  return { pageData, isLoading }
}
