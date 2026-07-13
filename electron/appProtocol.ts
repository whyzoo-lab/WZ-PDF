import { protocol } from 'electron'
import path from 'path'
import fs from 'fs'
import { PROD_CSP } from './csp'

const APP_MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.tar': 'application/x-tar', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.txt': 'text/plain', '.map': 'application/json',
}

/**
 * Serve the Vite-built renderer (and the bundled OCR model/wasm assets under
 * dist/ocr/) over app://, attaching the production CSP to every response. The
 * onHeadersReceived CSP does not fire for custom protocols, so the CSP lives
 * here instead.
 *
 * NOTE: this module must compile flat into electron/ (rootDir=outDir=electron)
 * so `__dirname` resolves to electron/ and `../dist` points at the build output.
 */
export function serveAppProtocol() {
  const dist = path.join(__dirname, '..', 'dist')
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/' || pathname === '') pathname = '/index.html'
    const filePath = path.normalize(path.join(dist, pathname))
    // Never serve outside the dist directory.
    if (!filePath.startsWith(dist)) return new Response('forbidden', { status: 403 })
    try {
      const data = await fs.promises.readFile(filePath)
      const type = APP_MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': type, 'Content-Security-Policy': PROD_CSP },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
