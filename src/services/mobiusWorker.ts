// The loading animation, drawn off the page's main thread.
//
// Opening a large document is main-thread work: a spreadsheet is parsed
// there (hucre; a 116 MB CSV holds the thread for seconds), and so are a
// TIFF's pixels and much of a PDF's set-up. An animation drawn on the page
// stops for exactly as long as the wait it is there to cover — the reader
// saw it appear, vanish, and the "loading…" text sit alone for the rest of
// the wait, because the view's loader mounted and the parse began in the
// same task, before its first frame. On an OffscreenCanvas a worker draws
// and commits frames itself, so the animation keeps moving however long the
// page is busy.

import { runLoader, type LoaderStart } from './mobiusDraw'

type Message =
  | ({ type: 'start'; canvas: OffscreenCanvas } & LoaderStart)
  | { type: 'dark'; dark: boolean }
  | { type: 'frames' }

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Message>) => void) | null
  requestAnimationFrame?: (cb: (now: number) => void) => number
  cancelAnimationFrame?: (id: number) => void
}

let loader: ReturnType<typeof runLoader> | null = null

scope.onmessage = e => {
  const m = e.data
  if (m.type === 'dark') { loader?.setDark(m.dark); return }
  if (m.type === 'frames') { (self as unknown as { postMessage(m: unknown): void }).postMessage({ type: 'frames', frames: loader?.frames() ?? 0 }); return }
  if (m.type !== 'start' || loader) return
  const { canvas, ...start } = m
  canvas.width = Math.round(start.size * start.dpr)
  canvas.height = Math.round(start.size * start.dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  // Workers in Chromium have requestAnimationFrame for OffscreenCanvas; a
  // timer stands in elsewhere.
  const raf = scope.requestAnimationFrame?.bind(self) ?? ((cb: (now: number) => void) => setTimeout(() => cb(performance.now()), 16) as unknown as number)
  const cancel = scope.cancelAnimationFrame?.bind(self) ?? ((id: number) => clearTimeout(id))
  loader = runLoader(ctx, start, raf, cancel, () => performance.now())
  // runLoader drew the first frame; it is committed when this task ends.
  ;(self as unknown as { postMessage(m: unknown): void }).postMessage({ type: 'drawn' })
}
