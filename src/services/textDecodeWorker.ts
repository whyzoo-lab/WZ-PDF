// Turns a text file's bytes into a string off the page's main thread.
//
// A 221 MB CP949 PSV took 2.6 s to decode in the app (Chromium's EUC-KR
// decoder; Node does it in 0.34 s), all of it holding the main thread while
// the file was opening. See services/textDecode.ts.

import { decodeText } from '../utils/text'

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ArrayBuffer>) => void) | null
  postMessage(m: unknown): void
}

scope.onmessage = e => {
  try {
    scope.postMessage({ text: decodeText(e.data) })
  } catch (err) {
    scope.postMessage({ error: err instanceof Error ? err.message : String(err) })
  }
}
