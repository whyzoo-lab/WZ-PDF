import { app, BrowserWindow, Menu, ipcMain, dialog, shell, session, protocol, net } from 'electron'
import path from 'path'
import fs from 'fs'

let win: BrowserWindow | null = null
let pendingFile: string | null = null

// ── Security limits ────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 500 * 1024 * 1024  // 500 MB — defensive cap on read-file IPC

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

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
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
    const allowed =
      navUrl.startsWith('app://') ||
      navUrl.startsWith('http://localhost:5173')
    if (!allowed) {
      event.preventDefault()
    }
  })

  // External links (http/https) open in the user's default browser; everything
  // else is blocked. We never open a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url).catch(() => { /* ignore */ })
    }
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

function extractEmbeddedPdf(): Buffer | null {
  // Only the portable SFX entry point carries embedded PDFs — the NSIS app
  // never has bytes appended to its own exe. Skip when not portable.
  const exeFile = process.env['PORTABLE_EXECUTABLE_FILE']
  if (!exeFile) return null

  try {
    if (!fs.existsSync(exeFile)) return null
    const exeBytes = fs.readFileSync(exeFile)
    if (exeBytes.length < EMBED_FOOTER) return null

    // Check marker at the very end
    const marker = exeBytes.slice(exeBytes.length - EMBED_MARKER.length)
    if (!marker.equals(EMBED_MARKER)) return null

    // Read PDF size (4 bytes before the marker)
    const sizeOffset = exeBytes.length - EMBED_FOOTER
    const pdfSize    = exeBytes.readUInt32LE(sizeOffset)
    if (pdfSize === 0) return null

    const pdfOffset = sizeOffset - pdfSize
    if (pdfOffset < 0) return null

    console.log('[WZ PDF] Embedded PDF detected — size:', pdfSize, 'bytes')
    return exeBytes.slice(pdfOffset, pdfOffset + pdfSize)
  } catch (err) {
    console.warn('[WZ PDF] extractEmbeddedPdf failed:', err)
    return null
  }
}

// ── IPC: export-exe ─────────────────────────────────────────────────────────
ipcMain.handle('export-exe', async (_event, pdfData: ArrayBuffer) => {
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
    const exeBytes  = fs.readFileSync(baseExe)
    const pdfBytes  = Buffer.from(pdfData)
    const sizeBytes = Buffer.allocUnsafe(4)
    sizeBytes.writeUInt32LE(pdfBytes.length)

    const output = Buffer.concat([exeBytes, pdfBytes, sizeBytes, EMBED_MARKER])
    fs.writeFileSync(filePath, output)

    console.log('[WZ PDF] Viewer EXE exported to:', filePath, '— total size:', output.length)
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
//   - extension is `.pdf`
//   - path resolves to a real, regular file
//   - size is below MAX_FILE_SIZE
// ── IPC: fetch-url ───────────────────────────────────────────────────────
// Download a PDF from an http(s) URL in the main process. Unlike the renderer,
// the main process isn't bound by CORS, so this works for any reachable host.
// Hardened: only http/https, follows the same MAX_FILE_SIZE cap, and verifies
// the response looks like a PDF.
ipcMain.handle('fetch-url', async (_event, rawUrl: unknown): Promise<ArrayBuffer> => {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    throw new Error('Invalid URL')
  }
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Malformed URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed')
  }
  const res = await fetch(url.href, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`)

  const len = Number(res.headers.get('content-length') ?? '0')
  if (len > MAX_FILE_SIZE) {
    throw new Error(`File exceeds ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB limit`)
  }
  const buf = await res.arrayBuffer()
  if (buf.byteLength > MAX_FILE_SIZE) {
    throw new Error(`File exceeds ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB limit`)
  }
  // Sanity-check the PDF magic bytes (%PDF).
  const head = new Uint8Array(buf.slice(0, 5))
  const sig = String.fromCharCode(...head)
  if (!sig.startsWith('%PDF')) {
    throw new Error('The URL did not return a PDF file')
  }
  return buf
})

ipcMain.handle('read-file', async (_event, filePath: unknown): Promise<ArrayBuffer> => {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('Invalid file path')
  }
  const resolved = path.resolve(filePath)
  if (!resolved.toLowerCase().endsWith('.pdf')) {
    throw new Error('Only .pdf files are allowed')
  }
  // Resolve symlinks before any check: a `foo.pdf` symlink pointing at
  // /etc/shadow would otherwise pass the extension test and leak the target.
  // We validate the REAL path's extension + that it's a regular file.
  const real = await fs.promises.realpath(resolved)
  if (!real.toLowerCase().endsWith('.pdf')) {
    throw new Error('Resolved path is not a .pdf file')
  }
  const stat = await fs.promises.lstat(real)
  if (!stat.isFile()) {
    throw new Error('Path is not a regular file')
  }
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`File exceeds ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB limit`)
  }
  const data = await fs.promises.readFile(real)
  // Return a fresh ArrayBuffer slice (Buffer view → standalone ArrayBuffer)
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
})

// ── IPC: open-help ─────────────────────────────────────────────────────────
// Opens `help.html` (shipped alongside the renderer build) in the user's
// default browser via shell.openExternal. Reachable from F1 in the renderer.
ipcMain.handle('open-help', async (_event, lang?: unknown) => {
  try {
    // Korean → help.html, anything else → help.en.html. Validate the arg so a
    // compromised renderer can't smuggle an arbitrary filename into the path.
    const helpFile = lang === 'ko' ? 'help.html' : 'help.en.html'
    let url: string
    if (app.isPackaged) {
      // dist/<helpFile> is copied from public/ during vite build
      const helpPath = path.join(__dirname, '..', 'dist', helpFile)
      // file:// URL with forward slashes works on all platforms
      url = 'file:///' + helpPath.replace(/\\/g, '/')
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

ipcMain.handle('check-update', async () => {
  try {
    const res = await net.fetch(UPDATE_MANIFEST_URL, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    console.error('[WZ PDF] check-update failed:', err instanceof Error ? err.message : String(err))
    return null
  }
})

ipcMain.handle('open-download', async (_event, rawUrl?: unknown) => {
  // Only ever open the trusted update host — never an arbitrary renderer-supplied URL.
  const target =
    typeof rawUrl === 'string' && rawUrl.startsWith(UPDATE_HOST_PREFIX)
      ? rawUrl
      : 'https://whyzoo.com/WzPDF/download.php'
  await shell.openExternal(target)
  return { success: true }
})

// (The previous `print-window` IPC used `webContents.print()`, which opens
// the OS system print dialog with no real preview on Windows. The renderer
// now calls `window.print()` directly instead — same Chromium under Electron
// gives us the proper Chrome-style print preview in the desktop app too.)

// ── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  installCsp()
  if (app.isPackaged) serveAppProtocol()
  Menu.setApplicationMenu(null)
  createWindow()

  // Determine what to open on startup (priority: CLI arg > open-file event > embedded PDF)
  // CLI arg covers both manual launches (`WZ_PDF.exe foo.pdf`) and the OS
  // file-association entry point (double-click a .pdf in Explorer).
  const argFile = process.argv.find(arg => /\.pdf$/i.test(arg))

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
    // Check for a PDF embedded in this portable exe (viewer-exe mode)
    const embedded = extractEmbeddedPdf()
    if (embedded && win) {
      win.webContents.once('did-finish-load', () => {
        // Send as a transferable ArrayBuffer so the renderer can use it directly
        win?.webContents.send('open-pdf-bytes', embedded.buffer)
      })
    }
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
