import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

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

// `?cli=1` — the hidden window the hwp2pdf console tool drives. The page still
// renders normally (the converter needs this document's canvas and fonts); this
// only publishes the entry point the main process calls into.
if (new URLSearchParams(window.location.search).has('cli')) {
  void import('./services/cliBridge').then(m => m.installCliBridge())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Nothing above App caught a render error, so one meant a blank window
        with no way out but Task Manager. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
