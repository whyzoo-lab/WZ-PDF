// The page's side of services/sheetBook.ts: the same requests, answered by a
// worker that holds the workbook, or by a SheetBook in the page where no
// worker can be started (tests, a refused worker).

import type { BookInfo, SheetBook, SheetMetrics, SheetRows } from './sheetBook'
import { EncryptedWorkbookError } from './sheetErrors'

export interface SheetHost {
  info: BookInfo
  layout(index: number): Promise<SheetMetrics | null>
  rows(id: number, from: number, to: number, cFrom: number, cTo: number): Promise<SheetRows>
  prepare(id: number): void
  /** Matching cells as [row, column, …]; null when overtaken by a newer search. */
  find(id: number, needle: string): Promise<Int32Array | null>
  cancelFind(): void
  pdf(index: number): Promise<{ css: string; pieces: number }>
  pdfPiece(index: number, piece: number): Promise<string>
  close(): void
}

function localHost(book: SheetBook): SheetHost {
  return {
    info: book.info(),
    layout: async index => book.layout(index),
    rows: async (id, from, to, cFrom, cTo) => book.rows(id, from, to, cFrom, cTo),
    prepare: id => book.prepare(id),
    find: (id, needle) => book.find(id, needle),
    cancelFind: () => book.cancelFind(),
    pdf: async index => book.pdf(index),
    pdfPiece: async (index, piece) => book.pdfPiece(index, piece),
    close: () => undefined,
  }
}

/** The worker could not run at all (as opposed to the workbook failing to read). */
class WorkerFailed extends Error {}

type Reply = { id: number; result?: unknown; error?: string; encrypted?: boolean }

async function workerHost(bytes: ArrayBuffer, name: string): Promise<SheetHost> {
  const worker = new Worker(new URL('./sheetWorker.ts', import.meta.url), { type: 'module' })
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
  let nextId = 1
  let dead: Error | null = null
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.error === undefined) p.resolve(e.data.result)
    else p.reject(e.data.encrypted ? new EncryptedWorkbookError() : new Error(e.data.error))
  }
  worker.onerror = e => {
    e.preventDefault()
    dead = new WorkerFailed(e.message || 'sheet worker failed')
    for (const p of pending.values()) p.reject(dead)
    pending.clear()
    worker.terminate()
  }
  const call = <T>(op: string, ...args: unknown[]): Promise<T> => {
    if (dead) return Promise.reject(dead)
    return new Promise<T>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      // The bytes are copied, not transferred: the page keeps them (save
      // original, the viewer exe).
      worker.postMessage({ id, op, args })
    })
  }
  let info: BookInfo
  try {
    info = await call<BookInfo>('open', bytes, name)
  } catch (err) {
    worker.terminate()
    throw err
  }
  return {
    info,
    layout: index => call('layout', index),
    rows: (id, from, to, cFrom, cTo) => call('rows', id, from, to, cFrom, cTo),
    prepare: id => { void call('prepare', id).catch(() => undefined) },
    find: (id, needle) => call('find', id, needle),
    cancelFind: () => { void call('cancelFind').catch(() => undefined) },
    pdf: index => call('pdf', index),
    pdfPiece: (index, piece) => call('pdfPiece', index, piece),
    close: () => {
      worker.terminate()
      const gone = new Error('closed')
      for (const p of pending.values()) p.reject(gone)
      pending.clear()
      dead = gone
    },
  }
}

/** Reads a workbook off the main thread where possible. */
export async function openSheetHost(bytes: ArrayBuffer, name: string): Promise<SheetHost> {
  if (typeof Worker !== 'undefined') {
    try {
      return await workerHost(bytes, name)
    } catch (err) {
      if (!(err instanceof WorkerFailed) && !(err instanceof TypeError || err instanceof DOMException)) throw err
      console.warn('Sheet worker unavailable, reading in the page:', err)
    }
  }
  // Only here are the readers loaded into the page.
  const { SheetBook: Book } = await import('./sheetBook')
  return localHost(await Book.open(bytes, name))
}
