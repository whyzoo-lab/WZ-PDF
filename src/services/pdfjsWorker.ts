// pdfjs worker bootstrap, kept OUT of the startup critical path.
//
// The worker URL is a blob that first installs two polyfills, then imports the
// real pdfjs worker module. Both polyfills are also installed on the main
// thread in main.tsx — pdfjs-dist 5.x needs them in BOTH places and the app
// breaks in Electron's Chromium without either copy:
//   - Uint8Array.prototype.toHex          (Chrome 129+)
//   - Map.prototype.getOrInsertComputed   (Chrome 131+)
// The blob runs as a Module Worker ({type:"module"}), so top-level await is valid.
//
// This module deliberately does NOT import pdfjs-dist: `new URL(..., import.meta.url)`
// only emits the worker file as an asset, so importing this module costs a few
// bytes instead of pulling the ~400 KB pdfjs chunk into the entry bundle.

const WORKER_POLYFILLS =
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

let workerUrl: string | null = null

/** Blob URL for the polyfilled pdfjs worker. Created once, on first use. */
export function getPdfWorkerUrl(): string {
  if (!workerUrl) {
    const realWorker = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString()
    workerUrl = URL.createObjectURL(
      new Blob(
        [WORKER_POLYFILLS + `await import(${JSON.stringify(realWorker)});`],
        { type: 'text/javascript' },
      ),
    )
  }
  return workerUrl
}
