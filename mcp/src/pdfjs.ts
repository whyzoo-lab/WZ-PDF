import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
// Type-only: erased at compile time, so it cannot re-introduce the eager
// import whose evaluation order this module exists to control.
import type * as Pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

/**
 * pdfjs, loaded after the handful of browser globals it insists on exist.
 *
 * `pdfjs-dist/legacy/build/pdf.mjs` evaluates `new DOMMatrix()` at module scope.
 * In Node it normally gets that from `@napi-rs/canvas`, an optional dependency
 * whose Windows binary is **37 MB** — all of it a Skia renderer, which this
 * server never uses: the only pdfjs calls here are `getDocument`, `getPage` and
 * `getTextContent`. Shipping 37 MB of rasteriser to satisfy one constructor call
 * is a poor trade, so the three constructors are stubbed instead.
 *
 * The import is dynamic on purpose. Static imports are evaluated before any code
 * in the importing module, so a stub installed at the top of a module still runs
 * too late — and in a bundle, esbuild hoists external imports above everything.
 * `await import()` is what lets the stubs be in place first.
 *
 * If a future pdfjs starts doing real geometry during text extraction, this will
 * fail loudly (a stub method that does not exist), not silently — and the fix is
 * to depend on `@napi-rs/canvas` again.
 */

function installCanvasStubs(): void {
  const g = globalThis as Record<string, unknown>

  if (typeof g.DOMMatrix === 'undefined') {
    g.DOMMatrix = class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
      constructor(init?: number[]) {
        if (Array.isArray(init) && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init
        }
      }
    }
  }
  if (typeof g.ImageData === 'undefined') {
    g.ImageData = class ImageData {
      readonly data: Uint8ClampedArray
      constructor(readonly width: number, readonly height: number) {
        this.data = new Uint8ClampedArray(width * height * 4)
      }
    }
  }
  if (typeof g.Path2D === 'undefined') {
    g.Path2D = class Path2D {}
  }
}

installCanvasStubs()

/**
 * Where pdfjs lives.
 *
 * Shipped, the two files sit in `pdfjs/` beside this bundle. They are NOT under
 * a `node_modules/` directory because electron-builder refuses to copy one into
 * extraResources — the server then starts without pdfjs and dies on the first
 * import. From a source checkout neither file is there and the ordinary package
 * resolution is used instead.
 */
const shippedPdf = new URL('./pdfjs/pdf.mjs', import.meta.url)
const isShipped = existsSync(fileURLToPath(shippedPdf))

/** pdfjs loads its worker by dynamic import, which needs a file:// URL on Windows. */
export const pdfWorkerSrc = isShipped
  ? new URL('./pdfjs/pdf.worker.mjs', import.meta.url).href
  : pathToFileURL(
      createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href

export const pdfjs: typeof Pdfjs = await import(
  isShipped ? shippedPdf.href : 'pdfjs-dist/legacy/build/pdf.mjs'
)
