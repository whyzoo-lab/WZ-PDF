import { useState, useEffect } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'

interface UsePdfDocumentReturn {
  pdfDoc: PDFDocumentProxy | null
  numPages: number
  isLoading: boolean
  error: string | null
}

export function usePdfDocument(file: File | null): UsePdfDocumentReturn {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setPdfDoc(null)
      setNumPages(0)
      setError(null)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    file.arrayBuffer()
      .then(buffer => pdfjs.getDocument({ data: buffer }).promise)
      .then(doc => {
        if (cancelled) return
        setPdfDoc(doc)
        setNumPages(doc.numPages)
        setIsLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load PDF')
        setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [file])

  return { pdfDoc, numPages, isLoading, error }
}
