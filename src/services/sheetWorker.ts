// The workbook's home while SheetView shows it — see services/sheetBook.ts.
//
// One worker per open workbook. Requests are { id, op, args }; each is
// answered { id, result } or { id, error, encrypted }. Long ones (opening,
// building find's index, searching) yield now and then, so a request for rows
// to draw is answered while they run.

import { SheetBook } from './sheetBook'
import { EncryptedWorkbookError } from './sheetErrors'

type Request = { id: number; op: string; args: unknown[] }

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null
  postMessage(m: unknown, transfer?: Transferable[]): void
}

let book: Promise<SheetBook> | null = null

async function run(op: string, args: unknown[]): Promise<unknown> {
  if (op === 'open') {
    const [bytes, name] = args as [ArrayBuffer, string]
    book = SheetBook.open(bytes, name)
    return (await book).info()
  }
  if (!book) throw new Error('no workbook')
  const b = await book
  switch (op) {
    case 'layout': return b.layout(args[0] as number)
    case 'rows': {
      const [id, from, to, cFrom, cTo] = args as number[]
      return b.rows(id, from, to, cFrom, cTo)
    }
    case 'prepare': b.prepare(args[0] as number); return null
    case 'find': return b.find(args[0] as number, args[1] as string)
    case 'cancelFind': b.cancelFind(); return null
    case 'pdf': return b.pdf(args[0] as number)
    case 'pdfPiece': return b.pdfPiece(args[0] as number, args[1] as number)
    default: throw new Error(`unknown request ${op}`)
  }
}

scope.onmessage = e => {
  const { id, op, args } = e.data
  run(op, args).then(
    result => {
      // Matches are a typed array the worker has no further use for.
      const transfer = result instanceof Int32Array ? [result.buffer] : []
      scope.postMessage({ id, result }, transfer)
    },
    err => scope.postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
      encrypted: err instanceof EncryptedWorkbookError,
    }),
  )
}
