import { useState, useCallback } from 'react'
import { t } from '../i18n'
import { errorMessage } from '../utils/errors'
import type { ViewerDoc } from '../types/viewerDoc'
import type { EntriesResult } from '../services/imageSetOps'

type PageOpResult = { newBytes: ArrayBuffer; pageMapping: Map<number, number> }

interface UsePageOperationsArgs {
  fileBytes: ArrayBuffer | null
  /**
   * Why `fileBytes` is null for good rather than still loading — a document
   * too large to hold is paged in for viewing only. Reported instead of editing.
   */
  bytesUnavailable: string | null
  /** Password the document was opened with, if it is encrypted. */
  documentPassword: string | null
  /** Called when an op succeeds — caller updates file state + annotations. */
  onResult: (newBytes: ArrayBuffer, pageMapping: Map<number, number>) => void
  /** Every failure ends here — the page list looking unchanged is not a message. */
  onError: (err: unknown) => void
  /**
   * An image collection (services/imageSet.ts). Its pages are edited as a list
   * of pictures rather than as PDF bytes, and the result is a new collection
   * file, handed to `onImagesResult` — the same replace-the-file step a PDF
   * edit takes, so undo works the same way.
   */
  imageDoc?: ViewerDoc | null
  onImagesResult?: (file: File, pageMapping: Map<number, number>) => void
}

/**
 * Page CRUD operations (delete / insert blank / insert from PDF / reorder).
 * `pdfPageService` is lazy-imported on first use to keep pdf-lib out of the
 * initial bundle.
 *
 * `isPageOperating` gates the panel UI while an operation is in flight,
 * preventing overlapping clicks during pdf-lib's slow re-serialization.
 */
export function usePageOperations({ fileBytes, bytesUnavailable, documentPassword, onResult, onError, imageDoc, onImagesResult }: UsePageOperationsArgs) {
  const [isPageOperating, setIsPageOperating] = useState(false)
  const images = imageDoc?.images ?? null

  /** Run an edit on an image collection's entry list. */
  const runImages = useCallback(async (op: () => Promise<EntriesResult>): Promise<boolean> => {
    if (!images || !onImagesResult) return false
    setIsPageOperating(true)
    try {
      const { entries, pageMapping } = await op()
      const { manifestFile } = await import('../services/imageSet')
      // Stay on the same picture where there still is one.
      onImagesResult(manifestFile(images.name, entries), pageMapping)
      return true
    } catch (err) {
      console.error('Image page operation failed:', err)
      onError(err)
      return false
    } finally {
      setIsPageOperating(false)
    }
  }, [images, onImagesResult, onError])

  /** Pictures added from the page list's "add images". */
  const handleInsertImages = useCallback(async (afterPage: number, files: File[]) => {
    await runImages(async () => {
      const [set, ops] = await Promise.all([import('../services/imageSet'), import('../services/imageSetOps')])
      const { entries } = await set.entriesFor(files.map(set.sourceFromFile))
      if (entries.length === 0) throw new Error(t('error.noImages'))
      return ops.insertEntries(images!.entries, afterPage, entries)
    })
  }, [runImages, images])

  /**
   * True when there are no bytes to edit. A document too large to hold says so;
   * one whose bytes are simply still being read stays quiet, as before.
   */
  const blocked = useCallback((): boolean => {
    // Checked first: a HWP or image has bytes, just not PDF ones.
    if (bytesUnavailable) { onError(new Error(bytesUnavailable)); return true }
    return !fileBytes
  }, [fileBytes, bytesUnavailable, onError])

  /**
   * Shared wrapper for the four ops — flips `isPageOperating`, awaits the
   * service call, and reports the result. Errors are funnelled through the
   * caller-provided `onError` so each op can show a user-friendly message.
   */
  const runOp = useCallback(
    async (
      op: () => Promise<PageOpResult>,
      onError: (err: unknown) => void,
    ): Promise<boolean> => {
      if (!fileBytes) return false
      setIsPageOperating(true)
      try {
        const { newBytes, pageMapping } = await op()
        onResult(newBytes, pageMapping)
        return true
      } catch (err) {
        onError(err)
        return false
      } finally {
        setIsPageOperating(false)
      }
    },
    [fileBytes, onResult],
  )

  /** Resolves true once the pages are gone. */
  const handleDeletePages = useCallback(async (pageNums: number[]): Promise<boolean> => {
    if (images) return runImages(async () => (await import('../services/imageSetOps')).deleteEntries(images.entries, pageNums))
    if (blocked() || !fileBytes) return false
    return runOp(
      async () => {
        const { deletePages } = await import('../services/pdfPageService')
        return deletePages(fileBytes, pageNums, documentPassword ?? undefined)
      },
      err => { console.error('Delete pages failed:', err); onError(err) },
    )
  }, [fileBytes, blocked, documentPassword, runOp, onError, images, runImages])

  const handleInsertBlankPage = useCallback(async (afterPage: number) => {
    if (images && imageDoc) {
      await runImages(async () => {
        // The size of the page it goes after, as a PDF's blank page is.
        const like = await imageDoc.getPage(Math.max(1, Math.min(afterPage, imageDoc.numPages)))
        const { width, height } = like.getViewport({ scale: 1 })
        const [set, ops] = await Promise.all([import('../services/imageSet'), import('../services/imageSetOps')])
        const blank = await set.blankSource(width, height)
        const { entries } = await set.entriesFor([blank])
        return ops.insertEntries(images.entries, afterPage, entries)
      })
      return
    }
    if (blocked() || !fileBytes) return
    await runOp(
      async () => {
        const { insertBlankPage } = await import('../services/pdfPageService')
        return insertBlankPage(fileBytes, afterPage, documentPassword ?? undefined)
      },
      err => { console.error('Insert blank page failed:', err); onError(err) },
    )
  }, [fileBytes, blocked, documentPassword, runOp, onError, images, imageDoc, runImages])

  const handleInsertFromPdf = useCallback(async (afterPage: number, srcBytes: ArrayBuffer) => {
    if (blocked() || !fileBytes) return
    await runOp(
      async () => {
        const { insertPagesFromPdf } = await import('../services/pdfPageService')
        return insertPagesFromPdf(fileBytes, srcBytes, afterPage, documentPassword ?? undefined)
      },
      err => {
        console.error('Insert from PDF failed:', err)
        onError(new Error(t('error.pdfInsertFailed', { error: errorMessage(err) })))
      },
    )
  }, [fileBytes, blocked, documentPassword, runOp, onError])

  const handleReorderPages = useCallback(async (newOrder: number[]) => {
    if (images) { await runImages(async () => (await import('../services/imageSetOps')).reorderEntries(images.entries, newOrder)); return }
    if (blocked() || !fileBytes) return
    await runOp(
      async () => {
        const { reorderPages } = await import('../services/pdfPageService')
        return reorderPages(fileBytes, newOrder, documentPassword ?? undefined)
      },
      err => { console.error('Reorder pages failed:', err); onError(err) },
    )
  }, [fileBytes, blocked, documentPassword, runOp, onError, images, runImages])

  return {
    isPageOperating,
    handleDeletePages,
    handleInsertBlankPage,
    handleInsertFromPdf,
    handleReorderPages,
    handleInsertImages,
  }
}
