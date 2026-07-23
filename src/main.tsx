import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// ─── Main-thread polyfills ────────────────────────────────────────────────────
// pdfjs-dist 5.x uses Uint8Array.prototype.toHex (Chrome 129+).
if (!Uint8Array.prototype.toHex) {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    value(this: Uint8Array): string {
      let h = ''
      for (let i = 0; i < this.length; i++) h += this[i].toString(16).padStart(2, '0')
      return h
    },
    writable: true, configurable: true,
  })
}

// pdfjs-dist 5.x uses Map.prototype.getOrInsertComputed (Chrome 131+).
// WorkerTransport.#cacheSimpleMethod calls this.#methodPromises.getOrInsertComputed(...)
// which throws immediately in Electron Chromium versions that lack this native Map method.
if (!Map.prototype.getOrInsertComputed) {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value<K, V>(this: Map<K, V>, key: K, fn: (key: K) => V): V {
      if (!this.has(key)) this.set(key, fn(key))
      return this.get(key)!
    },
    writable: true, configurable: true,
  })
}
// The matching WORKER-thread copies of both polyfills live in
// src/services/pdfjsWorker.ts, which also builds the worker blob URL. That
// module is imported lazily (first document load) together with pdfjs itself,
// so the ~400 KB pdfjs chunk stays out of the startup critical path — nothing
// here needs pdfjs until the user actually opens a file.
// ─────────────────────────────────────────────────────────────────────────────

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
