import { useState, useCallback } from 'react'

type PageOpResult = { newBytes: ArrayBuffer; pageMapping: Map<number, number> }

interface UsePageOperationsArgs {
  fileBytes: ArrayBuffer | null
  /** Called when an op succeeds — caller updates file state + annotations. */
  onResult: (newBytes: ArrayBuffer, pageMapping: Map<number, number>) => void
}

/**
 * Page CRUD operations (delete / insert blank / insert from PDF / reorder).
 * `pdfPageService` is lazy-imported on first use to keep pdf-lib out of the
 * initial bundle.
 *
 * `isPageOperating` gates the panel UI while an operation is in flight,
 * preventing overlapping clicks during pdf-lib's slow re-serialization.
 */
export function usePageOperations({ fileBytes, onResult }: UsePageOperationsArgs) {
  const [isPageOperating, setIsPageOperating] = useState(false)

  /**
   * Shared wrapper for the four ops — flips `isPageOperating`, awaits the
   * service call, and reports the result. Errors are funnelled through the
   * caller-provided `onError` so each op can show a user-friendly message.
   */
  const runOp = useCallback(
    async (
      op: () => Promise<PageOpResult>,
      onError: (err: unknown) => void,
    ) => {
      if (!fileBytes) return
      setIsPageOperating(true)
      try {
        const { newBytes, pageMapping } = await op()
        onResult(newBytes, pageMapping)
      } catch (err) {
        onError(err)
      } finally {
        setIsPageOperating(false)
      }
    },
    [fileBytes, onResult],
  )

  const handleDeletePages = useCallback(async (pageNums: number[]) => {
    if (!fileBytes) return
    await runOp(
      async () => {
        const { deletePages } = await import('../services/pdfPageService')
        return deletePages(fileBytes, pageNums)
      },
      err => console.error('페이지 삭제 실패:', err),
    )
  }, [fileBytes, runOp])

  const handleInsertBlankPage = useCallback(async (afterPage: number) => {
    if (!fileBytes) return
    await runOp(
      async () => {
        const { insertBlankPage } = await import('../services/pdfPageService')
        return insertBlankPage(fileBytes, afterPage)
      },
      err => console.error('빈 페이지 삽입 실패:', err),
    )
  }, [fileBytes, runOp])

  const handleInsertFromPdf = useCallback(async (afterPage: number, srcBytes: ArrayBuffer) => {
    if (!fileBytes) return
    await runOp(
      async () => {
        const { insertPagesFromPdf } = await import('../services/pdfPageService')
        return insertPagesFromPdf(fileBytes, srcBytes, afterPage)
      },
      err => {
        console.error('PDF 병합 실패:', err)
        alert(`PDF를 삽입할 수 없습니다: ${err instanceof Error ? err.message : String(err)}`)
      },
    )
  }, [fileBytes, runOp])

  const handleReorderPages = useCallback(async (newOrder: number[]) => {
    if (!fileBytes) return
    await runOp(
      async () => {
        const { reorderPages } = await import('../services/pdfPageService')
        return reorderPages(fileBytes, newOrder)
      },
      err => console.error('페이지 순서 변경 실패:', err),
    )
  }, [fileBytes, runOp])

  return {
    isPageOperating,
    handleDeletePages,
    handleInsertBlankPage,
    handleInsertFromPdf,
    handleReorderPages,
  }
}
