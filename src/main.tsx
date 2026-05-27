import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as pdfjs from 'pdfjs-dist'
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
// ─────────────────────────────────────────────────────────────────────────────

// Build the worker URL so we can reference it inside the blob wrapper.
const _pdfjsWorkerUrl = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// Worker-thread polyfills injected before the real pdfjs worker module loads.
// The blob runs as a Module Worker ({type:"module"}) so top-level await is valid.
const _workerPolyfills =
  // Uint8Array.prototype.toHex
  `if(!Uint8Array.prototype.toHex){` +
  `Object.defineProperty(Uint8Array.prototype,'toHex',{` +
  `value:function(){let h='';for(let i=0;i<this.length;i++)h+=this[i].toString(16).padStart(2,'0');return h;},` +
  `writable:true,configurable:true});` +
  `}` +
  // Map.prototype.getOrInsertComputed
  `if(!Map.prototype.getOrInsertComputed){` +
  `Object.defineProperty(Map.prototype,'getOrInsertComputed',{` +
  `value:function(key,fn){if(!this.has(key))this.set(key,fn(key));return this.get(key);},` +
  `writable:true,configurable:true});` +
  `}`

pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
  new Blob(
    [_workerPolyfills + `await import(${JSON.stringify(_pdfjsWorkerUrl)});`],
    { type: 'text/javascript' },
  ),
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
