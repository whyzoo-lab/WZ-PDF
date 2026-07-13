import { app, session } from 'electron'

// ── Production-only Content Security Policy ────────────────────────────────
// Dev mode (Vite + HMR) needs `unsafe-eval`/WebSocket which would weaken CSP.
// We only inject CSP for packaged builds where those aren't needed.
export const PROD_CSP = [
  "default-src 'self'",
  // 'wasm-unsafe-eval': pdfjs + onnxruntime-web compile WebAssembly.
  // 'unsafe-eval': the OCR runtime (onnxruntime-web + @techstark/opencv-js, both
  //   Emscripten builds) calls new Function()/eval() unconditionally; without it
  //   the OCR worker throws. Risk is contained: script-src still forbids loading
  //   external or inline scripts, eval is only reached by these bundled libs, and
  //   pdfjs does not execute PDF-embedded JavaScript, so no attacker-controlled
  //   string reaches eval.
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",      // inline style attrs from React/Konva
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // data:: onnxruntime-web fetches its inlined wasm via a data: URL.
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",                // pdfjs worker is a blob URL
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

export function installCsp() {
  if (!app.isPackaged) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [PROD_CSP],
      },
    })
  })
}
