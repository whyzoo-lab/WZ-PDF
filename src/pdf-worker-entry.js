/**
 * Custom pdfjs worker entry that polyfills Uint8Array.prototype.toHex
 * before loading the real pdfjs worker.
 * pdfjs-dist 5.x uses Uint8Array.prototype.toHex (added in Chrome 129),
 * which may not be available in all Electron worker contexts.
 */

if (typeof Uint8Array !== 'undefined' && !Uint8Array.prototype.toHex) {
  Uint8Array.prototype.toHex = function () {
    let hex = ''
    for (let i = 0; i < this.length; i++) {
      hex += this[i].toString(16).padStart(2, '0')
    }
    return hex
  }
}

// Re-export everything from the real pdfjs worker
export * from 'pdfjs-dist/build/pdf.worker.min.mjs'
