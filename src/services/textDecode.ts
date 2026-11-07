// Decoding a large text file (CSV/TSV/PSV, Markdown) in a worker.
//
// `decodeText` is a strict UTF-8 decode that falls back to CP949. On a 221 MB
// CP949 PSV it held the main thread for 2.6 s in the app, on top of parsing
// and laying the sheet out — time in which the window could not even redraw.
// In a worker the decode costs the page only the copy of the bytes going in
// and of the string coming back.
//
// Small files are decoded in place: starting a worker costs more than it saves.

import { decodeText } from '../utils/text'

/** Below this a file is decoded on the calling thread. */
export const DECODE_IN_WORKER_BYTES = 4 * 1024 * 1024

function decodeInWorker(bytes: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./textDecodeWorker.ts', import.meta.url), { type: 'module' })
    } catch (err) {
      reject(err)
      return
    }
    worker.onmessage = (e: MessageEvent<{ text?: string; error?: string }>) => {
      worker.terminate()
      if (typeof e.data.text === 'string') resolve(e.data.text)
      else reject(new Error(e.data.error ?? 'decode failed'))
    }
    worker.onerror = e => {
      worker.terminate()
      e.preventDefault()
      reject(new Error(e.message || 'decode worker failed'))
    }
    // A copy, not a transfer: the caller keeps its bytes (save original,
    // the viewer exe, find's size hint).
    worker.postMessage(bytes)
  })
}

/**
 * `decodeText`, off the main thread for a large file. Falls back to decoding
 * in place where no worker can be started (tests, a refused worker).
 */
export async function decodeTextOffThread(bytes: ArrayBuffer): Promise<string> {
  // Already in a worker (services/sheetWorker.ts): another would only copy the bytes again.
  const offPage = typeof document === 'undefined'
  if (bytes.byteLength < DECODE_IN_WORKER_BYTES || typeof Worker === 'undefined' || offPage) return decodeText(bytes)
  try {
    return await decodeInWorker(bytes)
  } catch (err) {
    console.warn('Text decode worker unavailable, decoding in place:', err)
    return decodeText(bytes)
  }
}
