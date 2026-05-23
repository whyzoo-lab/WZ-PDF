import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as pdfjs from 'pdfjs-dist'
import './index.css'
import App from './App'

// pdfjs-dist 5.x uses Uint8Array.prototype.toHex (Chrome 129+).
// In some Electron worker contexts the method is absent, so we inject a polyfill
// via a blob URL that runs before importing the real pdfjs worker.
const _pdfjsWorkerUrl = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
  new Blob(
    [
      // pdfjs 5.x creates workers with {type:"module"}, so this blob runs as a
      // Module Worker. Top-level `await` is supported and required — pdfjs's own
      // CDN wrapper uses the same `await import(url)` pattern to ensure the
      // worker module finishes setting up its message handlers before the worker
      // enters the event loop and starts receiving messages.
      `if(!Uint8Array.prototype.toHex){` +
      `Uint8Array.prototype.toHex=function(){` +
      `let h='';for(let i=0;i<this.length;i++)h+=this[i].toString(16).padStart(2,'0');return h;` +
      `};}` +
      `await import(${JSON.stringify(_pdfjsWorkerUrl)});`,
    ],
    { type: 'text/javascript' },
  ),
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
