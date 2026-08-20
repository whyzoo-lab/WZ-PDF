import { app, BrowserWindow, Menu, ipcMain, dialog, shell, session, protocol, net } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import path from 'path'
import fs from 'fs'
import { cliToolName, hasCliFlag, runCli } from './cliRunner'
import {
  FETCH_TIMEOUT_MS,
  MAX_DOCUMENT_BYTES,
  MAX_REDIRECTS,
  assertPublicHttpUrl,
  hasSupportedDocumentSignature,
  isAllowedDocumentPath,
  isTextDocumentPath,
  isTrustedRendererUrl,
  isTrustedUpdateUrl,
  parseHttpUrl,
  resolveAppAssetPath,
} from './security'

let win: BrowserWindow | null = null
let pendingFile: string | null = null

// ── Security limits ────────────────────────────────────────────────────────
const MAX_FILE_SIZE = MAX_DOCUMENT_BYTES

/**
 * The document path Windows/macOS passes when the user double-clicks a file.
 *
 * Skips argv[0] (our own .exe) and anything that looks like a switch, so a
 * Chromium flag such as `--log-file=out.pdf` can't be mistaken for the document
 * to open. Everything the app can display is eligible — the previous version
 * matched only pdf/hwp/hwpx, which is why associating .md by hand launched the
 * app to an empty window instead of showing the file.
 */
function findFileArgument(argv: readonly string[]): string | undefined {
  return argv.slice(1).find(arg => !arg.startsWith('-') && isAllowedDocumentPath(arg.toLowerCase()))
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  if (!event.senderFrame || !isTrustedRendererUrl(event.senderFrame.url)) {
    throw new Error('Untrusted IPC sender')
  }
}

// ── Production-only Content Security Policy ────────────────────────────────
// Dev mode (Vite + HMR) needs `unsafe-eval`/WebSocket which would weaken CSP.
// We only inject CSP for packaged builds where those aren't needed.
const PROD_CSP = [
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

function installCsp() {
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

// ── Custom app:// scheme for the packaged renderer ──────────────────────────
// The packaged app cannot load the renderer from file://: PaddleOCR.js (and
// onnxruntime-web) refuse to run under a file: origin — they require an
// http(s)/app origin so model assets can be fetched. We register a privileged
// `app://` scheme (standard + secure + fetch-enabled, so it behaves like a
// normal web origin for fetch() and CSP 'self') and serve the Vite build from
// it. Registration must happen before `app.whenReady()`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  },
])

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
 */
function serveAppProtocol() {
  const dist = path.join(__dirname, '..', 'dist')
  protocol.handle('app', async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405 })
    }
    const filePath = resolveAppAssetPath(dist, request.url)
    if (!filePath) return new Response('forbidden', { status: 403 })
    try {
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile()) return new Response('not found', { status: 404 })
      const type = APP_MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      const body = request.method === 'HEAD'
        ? null
        : Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(stat.size),
          'Content-Security-Policy': PROD_CSP,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    // Floor the window size so the toolbar and viewer never distort. Below
    // this the ActionBar folds its controls into hamburger menus (handled in
    // the renderer), but we still stop the window from shrinking absurdly.
    minWidth: 480,
    minHeight: 360,
    title: 'WZ PDF',
    // ── Custom title bar ────────────────────────────────────────────────
    // Hide the native title bar so the ActionBar visually becomes the chrome.
    // On Windows/Linux we use Window Controls Overlay: the OS still draws
    // accessible min/max/close buttons in the top-right, but we control the
    // background color, height, and symbol color so it blends with the app.
    // On macOS, `hiddenInset` shows the traffic-light controls inset slightly
    // — they sit on top of our dark toolbar without further configuration.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : {
      color: '#111827',         // matches Tailwind bg-gray-900 (the ActionBar bg)
      symbolColor: '#e5e7eb',   // matches Tailwind gray-200 (visible on dark bg)
      height: 48,               // matches the ActionBar's intrinsic height
    },
    backgroundColor: '#111827', // paints the same gray during the brief load gap
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // ── Hardened defaults (explicit even when matching defaults) ─────────
      contextIsolation: true,             // renderer + preload in separate contexts
      nodeIntegration: false,             // no `require` in renderer
      sandbox: true,                      // preload runs in an OS sandbox
      webSecurity: true,                  // enforce same-origin policy
      allowRunningInsecureContent: false, // no mixed content
      experimentalFeatures: false,        // no Chromium experimental APIs
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
    },
  })

  // Block in-app navigation to any URL except the renderer's own origin.
  // PDF content shouldn't be able to navigate the host window.
  win.webContents.on('will-navigate', (event, navUrl) => {
    if (!isTrustedRendererUrl(navUrl)) {
      event.preventDefault()
    }
  })

  // External links (http/https) open in the user's default browser; everything
  // else is blocked. We never open a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      shell.openExternal(parseHttpUrl(url).href).catch(() => { /* ignore */ })
    } catch { /* unsupported or malformed URL */ }
    return { action: 'deny' }
  })

  if (app.isPackaged) {
    // Production: serve the Vite build over app:// (NOT file://) so the OCR
    // runtime, which refuses to run on a file: origin, works. See serveAppProtocol.
    // Load app.html (the React app) — index.html is the web landing/demo page.
    win.loadURL('app://bundle/app.html')
  } else {
    // Development: load the React app from the Vite dev server (index.html is
    // the landing/demo page; the desktop app wants app.html directly).
    win.loadURL('http://localhost:5173/app.html')
  }

  win.on('closed', () => { win = null })
}

// ── Embedded PDF (viewer-exe mode) ─────────────────────────────────────────
//
// When the user exports a PDF as a standalone viewer exe, we:
//   1. Locate a portable SFX template (see findViewerTemplate below)
//   2. Append: [PDF bytes] [4-byte length UInt32LE] [EMBED_MARKER]
//
// On startup the app reads the original exe, detects the marker, and sends
// the PDF bytes to the renderer so they are loaded automatically.

const EMBED_MARKER = Buffer.from('WZPDF_VIEWER_V01')  // 16 bytes
const EMBED_FOOTER  = 4 + EMBED_MARKER.length          // UInt32LE length + marker = 20 bytes

async function readExactly(
  handle: Awaited<ReturnType<typeof fs.promises.open>>,
  buffer: Buffer,
  position: number,
): Promise<void> {
  let offset = 0
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, position + offset)
    if (bytesRead === 0) throw new Error('Unexpected end of file')
    offset += bytesRead
  }
}

/**
 * Find the portable-SFX template to use as the viewer EXE base.
 *
 * Two scenarios:
 *
 * 1. Running from the portable exe itself — `PORTABLE_EXECUTABLE_FILE` is
 *    set by electron-builder and points to the running SFX. Use that.
 *
 * 2. Running from the NSIS-installed app — no env var, but the installer
 *    bundled the portable as `<resources>/viewer-template.exe` via the
 *    afterPack hook. Use that.
 *
 * Returns `null` in dev mode (no template available; the feature is gated
 * on `window.electronAPI` in the renderer anyway).
 */
function findViewerTemplate(): string | null {
  const portableEnv = process.env['PORTABLE_EXECUTABLE_FILE']
  if (portableEnv && fs.existsSync(portableEnv)) {
    return portableEnv
  }

  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'viewer-template.exe')
    if (fs.existsSync(bundled)) {
      return bundled
    }
  }

  return null
}

async function extractEmbeddedPdf(): Promise<Buffer | null> {
  // Only the portable SFX entry point carries embedded PDFs — the NSIS app
  // never has bytes appended to its own exe. Skip when not portable.
  const exeFile = process.env['PORTABLE_EXECUTABLE_FILE']
  if (!exeFile) return null

  // IMPORTANT: read ONLY the 20-byte footer (and the embedded PDF, if any) —
  // never the whole exe. The portable exe is >140 MB, and a synchronous
  // full-file read here blocks the main-process event loop (including the
  // app:// protocol handler that serves the renderer), leaving the window on a
  // blank background for seconds while the OS/antivirus scans the read. The
  // common case (no PDF appended) now costs a single 20-byte read.
  let handle: Awaited<ReturnType<typeof fs.promises.open>> | null = null
  try {
    const stat = await fs.promises.stat(exeFile)
    if (stat.size < EMBED_FOOTER) return null

    handle = await fs.promises.open(exeFile, 'r')

    // Footer layout (last 20 bytes): [pdfSize UInt32LE (4)] [EMBED_MARKER (16)]
    const footer = Buffer.allocUnsafe(EMBED_FOOTER)
    await readExactly(handle, footer, stat.size - EMBED_FOOTER)
    if (!footer.subarray(4).equals(EMBED_MARKER)) return null

    const pdfSize = footer.readUInt32LE(0)
    if (pdfSize === 0 || pdfSize > MAX_FILE_SIZE) return null
    const pdfOffset = stat.size - EMBED_FOOTER - pdfSize
    if (pdfOffset < 0) return null

    const pdf = Buffer.alloc(pdfSize)   // dedicated ArrayBuffer (exact size for IPC transfer)
    await readExactly(handle, pdf, pdfOffset)
    if (!hasSupportedDocumentSignature(pdf) || pdf.subarray(0, 4).toString('ascii') !== '%PDF') return null
    console.log('[WZ PDF] Embedded PDF detected — size:', pdfSize, 'bytes')
    return pdf
  } catch (err) {
    console.warn('[WZ PDF] extractEmbeddedPdf failed:', err)
    return null
  } finally {
    await handle?.close()
  }
}

// ── IPC: export-exe ─────────────────────────────────────────────────────────
ipcMain.handle('export-exe', async (event, pdfData: unknown) => {
  assertTrustedIpcSender(event)
  if (!(pdfData instanceof ArrayBuffer)) {
    throw new Error('Invalid PDF data')
  }
  const pdfBytes = new Uint8Array(pdfData)
  if (pdfBytes.byteLength === 0 || pdfBytes.byteLength > MAX_FILE_SIZE) {
    throw new Error(`PDF must be between 1 byte and ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB`)
  }
  if (pdfBytes[0] !== 0x25 || pdfBytes[1] !== 0x50 || pdfBytes[2] !== 0x44 || pdfBytes[3] !== 0x46) {
    throw new Error('Invalid PDF signature')
  }

  const baseExe = findViewerTemplate()
  if (!baseExe) {
    return {
      success: false,
      error:
        'EXE Viewer 템플릿을 찾을 수 없습니다.\n\n' +
        '개발 모드에서는 이 기능을 사용할 수 없습니다.\n' +
        'npm run build:exe 로 빌드한 뒤 실행해주세요.',
    }
  }

  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Viewer EXE로 저장',
    defaultPath: 'WZ_PDF_Viewer.exe',
    filters: [{ name: 'Executable', extensions: ['exe'] }],
  })
  if (canceled || !filePath) return { success: false, canceled: true }

  try {
    const sizeBytes = Buffer.allocUnsafe(4)
    sizeBytes.writeUInt32LE(pdfBytes.byteLength)

    if (path.resolve(filePath) === path.resolve(baseExe)) {
      throw new Error('The viewer template cannot overwrite itself')
    }

    // Copy and append asynchronously. The old implementation synchronously
    // read the whole 140MB+ template and then Buffer.concat duplicated it,
    // blocking Electron's main loop and temporarily consuming hundreds of MB.
    await fs.promises.copyFile(baseExe, filePath)
    await fs.promises.appendFile(filePath, pdfBytes)
    await fs.promises.appendFile(filePath, sizeBytes)
    await fs.promises.appendFile(filePath, EMBED_MARKER)

    const outputSize = (await fs.promises.stat(filePath)).size
    console.log('[WZ PDF] Viewer EXE exported to:', filePath, '— total size:', outputSize)
    return { success: true, outputPath: filePath }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: `저장 실패: ${msg}` }
  }
})

// ── IPC: read-file ─────────────────────────────────────────────────────────
// Renderer cannot fetch('file://') from an http://localhost origin (CORS).
// This handler lets the renderer ask the main process to read a file for it.
//
// Defense-in-depth: even though the path normally comes from the OS (CLI arg
// or open-file event), a compromised renderer must not be able to read
// arbitrary files on disk. We enforce:
//   - input is a non-empty string
//   - extension is `.pdf`, `.hwp`, or `.hwpx`
//   - path resolves to a real, regular file
//   - size is below MAX_FILE_SIZE
// ── IPC: fetch-url ───────────────────────────────────────────────────────
// Download a document from a public http(s) URL in the main process. Redirects
// are validated individually, response time/size are bounded, and the file
// signature is checked before bytes cross the IPC boundary.
async function fetchRemoteDocument(rawUrl: unknown): Promise<ArrayBuffer> {
  let url = await assertPublicHttpUrl(rawUrl)
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  let response: Response | null = null

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    response = await fetch(url.href, { redirect: 'manual', signal })
    if (![301, 302, 303, 307, 308].includes(response.status)) break

    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location || redirects === MAX_REDIRECTS) throw new Error('Too many redirects')
    url = await assertPublicHttpUrl(new URL(location, url).href)
  }

  if (!response || !response.ok) {
    throw new Error(`Download failed (HTTP ${response?.status ?? 0})`)
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength) {
    const declaredBytes = Number(contentLength)
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > MAX_FILE_SIZE) {
      await response.body?.cancel()
      throw new Error(`File exceeds ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB limit`)
    }
  }
  if (!response.body) throw new Error('Download returned an empty response')

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_FILE_SIZE) {
        throw new Error(`File exceeds ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB limit`)
      }
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => { /* ignore cancellation failure */ })
    throw error
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (!hasSupportedDocumentSignature(bytes)) {
    throw new Error('The URL did not return a PDF, HWP, or HWPX file')
  }
  return bytes.buffer
}

ipcMain.handle('fetch-url', async (event, rawUrl: unknown): Promise<ArrayBuffer> => {
  assertTrustedIpcSender(event)
  return fetchRemoteDocument(rawUrl)
})

ipcMain.handle('read-file', async (event, filePath: unknown): Promise<ArrayBuffer> => {
  assertTrustedIpcSender(event)
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('Invalid file path')
  }
  const resolved = path.resolve(filePath)
  if (!isAllowedDocumentPath(resolved.toLowerCase())) {
    throw new Error('Unsupported file type')
  }
  // Resolve symlinks before any check: a `foo.pdf` symlink pointing at
  // /etc/shadow would otherwise pass the extension test and leak the target.
  // We validate the REAL path's extension + that it's a regular file.
  const real = await fs.promises.realpath(resolved)
  const lowerReal = real.toLowerCase()
  if (!isAllowedDocumentPath(lowerReal)) {
    throw new Error('Resolved path is not a supported document')
  }
  const handle = await fs.promises.open(real, 'r')
  try {
    // Stat and read through the same handle. Reading exactly the validated
    // size prevents a file that grows concurrently from bypassing the cap.
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Path is not a regular file')
    if (stat.size === 0 || stat.size > MAX_FILE_SIZE) {
      throw new Error(`File must be between 1 byte and ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB`)
    }
    const data = Buffer.allocUnsafe(stat.size)
    await readExactly(handle, data, 0)
    // Markdown and mail are plain text and have no signature to verify —
    // see TEXT_DOCUMENT_EXTENSIONS in security.ts for why that is sound here.
    if (!isTextDocumentPath(lowerReal) && !hasSupportedDocumentSignature(data)) {
      throw new Error('File content does not match a supported document format')
    }
    // Return a fresh ArrayBuffer slice (Buffer view → standalone ArrayBuffer)
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  } finally {
    await handle.close()
  }
})

// ── IPC: open-help ─────────────────────────────────────────────────────────
// Opens `help.html` (shipped alongside the renderer build) in the user's
// default browser via shell.openExternal. Reachable from F1 in the renderer.
ipcMain.handle('open-help', async (event, lang?: unknown) => {
  assertTrustedIpcSender(event)
  try {
    // Korean → help.html, anything else → help.en.html. Validate the arg so a
    // compromised renderer can't smuggle an arbitrary filename into the path.
    const helpFile = lang === 'ko' ? 'help.html' : 'help.en.html'
    let url: string
    if (app.isPackaged) {
      // dist/<helpFile> is copied from public/ during vite build
      const helpPath = path.join(__dirname, '..', 'dist', helpFile)
      url = pathToFileURL(helpPath).href
    } else {
      url = `http://localhost:5173/${helpFile}`
    }
    await shell.openExternal(url)
    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[WZ PDF] open-help failed:', msg)
    return { success: false, error: msg }
  }
})

// ── Optional update check ───────────────────────────────────────────────────
// The renderer asks the main process (no CORS) to read the version manifest;
// it compares against the running version and shows a dismissible toast. The
// download is opened in the user's browser — we never auto-install.
const UPDATE_MANIFEST_URL = 'https://whyzoo.com/WzPDF/version.php'
const UPDATE_HOST_PREFIX = 'https://whyzoo.com/'

ipcMain.handle('check-update', async (event) => {
  assertTrustedIpcSender(event)
  try {
    const res = await net.fetch(UPDATE_MANIFEST_URL, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    console.error('[WZ PDF] check-update failed:', err instanceof Error ? err.message : String(err))
    return null
  }
})

ipcMain.handle('open-download', async (event, rawUrl?: unknown) => {
  assertTrustedIpcSender(event)
  // Compare the parsed origin exactly; string prefixes are easy to get subtly wrong.
  const target = isTrustedUpdateUrl(rawUrl, new URL(UPDATE_HOST_PREFIX).origin)
    ? String(rawUrl)
    : 'https://whyzoo.com/WzPDF/download.php'
  await shell.openExternal(target)
  return { success: true }
})

// (The previous `print-window` IPC used `webContents.print()`, which opens
// the OS system print dialog with no real preview on Windows. The renderer
// now calls `window.print()` directly instead — same Chromium under Electron
// gives us the proper Chrome-style print preview in the desktop app too.)

// ── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  installCsp()
  if (app.isPackaged) serveAppProtocol()
  Menu.setApplicationMenu(null)

  // ── console converter mode ──────────────────────────────────────────────
  // Started by one of the hwp2pdf / hwp2hwpx / hwpx2hwp launchers, never by a
  // user double-click. Exits with a status code, so no visible app is created
  // on this path — hwp2pdf drives a window that is never shown, and the HWPX
  // converters need no window at all.
  if (hasCliFlag(process.argv)) {
    const page = app.isPackaged
      ? 'app://bundle/app.html?cli=1'
      : 'http://localhost:5173/app.html?cli=1'
    let code = 1
    try {
      code = await runCli(process.argv, page)
    } catch (err) {
      const tool = cliToolName(process.argv)
      process.stderr.write(`${tool} failed: ${err instanceof Error ? err.message : String(err)}
`)
    }
    app.exit(code)
    return
  }

  createWindow()

  // Determine what to open on startup (priority: CLI arg > open-file event > embedded PDF)
  // CLI arg covers both manual launches (`WZ_PDF.exe foo.pdf`) and the OS
  // file-association entry point (double-click a .pdf in Explorer).
  const argFile = findFileArgument(process.argv)

  if (argFile && win) {
    win.webContents.once('did-finish-load', () => {
      win?.webContents.send('open-file', argFile)
    })
  } else if (pendingFile && win) {
    const filePath = pendingFile
    pendingFile = null
    win.webContents.once('did-finish-load', () => {
      win?.webContents.send('open-file', filePath)
    })
  } else {
    // Check for a PDF embedded in this portable exe (viewer-exe mode). Runs
    // asynchronously so it never blocks the window's first paint; the read is
    // now a couple of small partial reads instead of the whole exe.
    extractEmbeddedPdf().then(embedded => {
      if (!embedded || !win) return
      // Send as a transferable ArrayBuffer so the renderer can use it directly.
      const send = () => win?.webContents.send('open-pdf-bytes', embedded.buffer)
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
      else send()
    }).catch(() => { /* extractEmbeddedPdf already logs; ignore */ })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (win) {
    win.webContents.send('open-file', filePath)
  } else {
    pendingFile = filePath
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Belt-and-suspenders: deny any webview creation app-wide. We don't use
// <webview> tags, but this prevents abuse if one slipped in.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
})
