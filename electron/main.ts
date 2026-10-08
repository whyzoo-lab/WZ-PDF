import { app, BrowserWindow, Menu, ipcMain, dialog, shell, session, protocol } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import path from 'path'
import fs from 'fs'
import { RecentFilesStore, isRecentCandidate } from './recentFiles'
import { PendingVideoSaves, cleanSuggestedName, validateMp4 } from './videoSave'
import {
  EMBED_FOOTER_BYTES, acceptEmbedded, buildTrailer, cleanEmbeddedName, isAcceptableDocument, locateEmbedded,
  type EmbeddedDocument,
} from './embeddedDocument'
import { registerUpdateIpc, startAutoUpdate } from './autoUpdate'
import {
  TemplateMismatchError, adoptTemplate, cachedTemplate, downloadTemplate, pruneOtherVersions, readManifest,
  type TemplateManifest,
} from './viewerTemplate'
import { cliToolName, hasCliFlag, runCli } from './cliRunner'
import { setBoost as setTtsBoost, shutdown as shutdownTts, synthesize as synthesizeSpeech, synthesizeBatch as synthesizeSpeechBatch } from './ttsEngine'
import { downloadModel, isVoiceId, modelStatus } from './ttsModel'
import {
  FETCH_TIMEOUT_MS,
  MAX_DOCUMENT_BYTES,
  MAX_RANGED_DOCUMENT_BYTES,
  MAX_REDIRECTS,
  assertPublicHttpUrl,
  hasSupportedDocumentSignature,
  isAllowedDocumentPath,
  isTextDocumentPath,
  allowsPermission,
  isTrustedRendererUrl,
  isValidByteRange,
  parseHttpUrl,
  resolveAppAssetPath,
  pinnedRequest,
  type PinnedResponse,
} from './security'

// The settings folder is fixed by name, not derived from the product's name.
// It holds the speech model (383 MB), saved stamps and the recent files, and
// Electron derives it from the app's name — which has changed once already
// (WZ PDF → WZ Reader, 1.25.0). Pinned to the folder every release so far has
// used, before anything can read it.
app.setPath('userData', path.join(app.getPath('appData'), 'wz-pdf'))

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

/** Whether a URL is our renderer. The Vite dev server counts only when not packaged. */
function isOurRenderer(rawUrl: string): boolean {
  return isTrustedRendererUrl(rawUrl, { devServer: !app.isPackaged })
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  if (!event.senderFrame || !isOurRenderer(event.senderFrame.url)) {
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

/**
 * Query the renderer is loaded with when a document is on its way (a file
 * double-clicked in Explorer, or passed on the command line). Without it the
 * window showed the start screen until the path arrived and the file was read —
 * the path can only be sent once the page has loaded. The renderer shows
 * "opening…" instead, and falls back to the start screen if the open fails.
 */
const OPENING_QUERY = '?open=1'

function createWindow({ opening = false }: { opening?: boolean } = {}) {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    // Floor the window size so the toolbar and viewer never distort. Below
    // this the ActionBar folds its controls into hamburger menus (handled in
    // the renderer), but we still stop the window from shrinking absurdly.
    minWidth: 480,
    minHeight: 360,
    title: 'WZ Reader',
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

  if (app.isPackaged) {
    // Production: serve the Vite build over app:// (NOT file://) so the OCR
    // runtime, which refuses to run on a file: origin, works. See serveAppProtocol.
    // Load app.html (the React app) — index.html is the web landing/demo page.
    win.loadURL(`app://bundle/app.html${opening ? OPENING_QUERY : ''}`)
  } else {
    // Development: load the React app from the Vite dev server (index.html is
    // the landing/demo page; the desktop app wants app.html directly).
    win.loadURL(`http://localhost:5173/app.html${opening ? OPENING_QUERY : ''}`)
  }

  win.on('closed', () => { win = null })

  // The renderer holds `beforeunload` while there are unsaved changes (stamps,
  // signatures, page edits, a Markdown edit). Electron does not show a prompt
  // for that — it cancels the close and emits this — so ask here. Not saving
  // lets the window go; Cancel keeps it open so the reader can save first.
  const owner = win
  win.webContents.on('will-prevent-unload', event => {
    const target = owner.isDestroyed() ? null : owner
    const ko = app.getLocale().toLowerCase().startsWith('ko')
    const options = {
      type: 'warning' as const,
      buttons: ko ? ['취소', '저장하지 않고 닫기'] : ['Cancel', 'Close without saving'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'WZ Reader',
      message: ko ? '저장하지 않은 변경 내용이 있습니다' : 'You have unsaved changes',
      detail: ko
        ? '지금 닫으면 도장·서명·페이지 편집 같은 변경 내용이 사라집니다. 저장하려면 취소를 누른 뒤 저장하세요.'
        : 'Closing now discards changes such as stamps, signatures and page edits. To keep them, cancel and save first.',
    }
    const choice = target ? dialog.showMessageBoxSync(target, options) : dialog.showMessageBoxSync(options)
    if (choice === 1) event.preventDefault() // preventDefault here means: unload anyway
  })
}

// ── Embedded document (viewer-exe mode) ────────────────────────────────────
//
// When the user exports a document as a standalone viewer exe, we:
//   1. Locate a portable SFX template (see findViewerTemplate below)
//   2. Append the document and a trailer naming it (electron/embeddedDocument.ts)
//
// On startup the app reads the original exe, finds the trailer, and sends the
// document to the renderer so it is opened automatically.

async function readExactly(
  handle: Awaited<ReturnType<typeof fs.promises.open>>,
  buffer: Uint8Array,
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
 * The portable exe a Viewer EXE is made from.
 *
 * 1. Running from the portable itself (`PORTABLE_EXECUTABLE_FILE`) — use it.
 * 2. Otherwise a verified copy kept in userData (see electron/viewerTemplate.ts).
 *
 * A `resources/viewer-template.exe` bundled by an install up to 1.23.0 is
 * deliberately not used: if an update left it behind it would be the *old*
 * version's portable, and every Viewer EXE would quietly be built from it.
 *
 * Null when none is on disk yet; `manifest` then says what to fetch (absent in
 * a development run, where there is no release to fetch from).
 */
async function findViewerTemplate(): Promise<{ path: string | null; manifest: TemplateManifest | null }> {
  const portableEnv = process.env['PORTABLE_EXECUTABLE_FILE']
  if (portableEnv && fs.existsSync(portableEnv)) return { path: portableEnv, manifest: null }
  if (!app.isPackaged) return { path: null, manifest: null }
  const manifest = await readManifest(process.resourcesPath, app.getVersion())
  if (!manifest) return { path: null, manifest: null }
  return { path: await cachedTemplate(app.getPath('userData'), manifest), manifest }
}

/**
 * Get the portable onto this machine the first time a Viewer EXE is made: ask,
 * then download it — or take one the reader picks, for a machine without
 * internet. Resolves the template path, or null if the reader declined.
 */
async function obtainViewerTemplate(sender: Electron.WebContents, manifest: TemplateManifest): Promise<string | null> {
  const owner = BrowserWindow.fromWebContents(sender)
  const ko = app.getLocale().toLowerCase().startsWith('ko')
  const mb = Math.round(manifest.size / 1048576)
  const options = {
    type: 'question' as const,
    buttons: ko ? [`내려받기 (약 ${mb}MB)`, '파일 직접 선택…', '취소'] : [`Download (about ${mb} MB)`, 'Choose the file…', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: 'WZ Reader',
    message: ko ? '뷰어 EXE를 만들려면 원본 프로그램이 필요합니다' : 'Making a Viewer EXE needs the portable program',
    detail: ko
      ? `처음 한 번만 WZ Reader 무설치판(${manifest.file}, 약 ${mb}MB)을 GitHub에서 내려받아 이 PC에 보관합니다. 다음부터는 바로 만들어집니다.\n\n인터넷이 안 되는 PC라면 같은 버전의 무설치판 파일을 직접 선택하세요.`
      : `Just once, the WZ Reader portable (${manifest.file}, about ${mb} MB) is downloaded from GitHub and kept on this PC. After that, Viewer EXEs are made straight away.\n\nOn a PC without internet, choose the portable file of the same version instead.`,
  }
  const { response } = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
  const userData = app.getPath('userData')
  await pruneOtherVersions(userData, manifest)

  if (response === 1) {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: manifest.file,
      filters: [{ name: 'WZ Reader', extensions: ['exe'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths[0]) return null
    try {
      return await adoptTemplate(userData, manifest, filePaths[0])
    } catch (err) {
      throw new Error(ko ? `선택한 파일이 이 버전의 무설치판(${manifest.file})이 아닙니다.` : `That file is not this version's portable (${manifest.file}).`, { cause: err })
    }
  }
  if (response !== 0) return null

  let lastPercent = -1
  try {
    return await downloadTemplate(userData, manifest, AbortSignal.timeout(30 * 60 * 1000), fraction => {
      const percent = Math.floor(fraction * 100)
      if (percent === lastPercent) return
      lastPercent = percent
      owner?.setProgressBar(fraction)
      if (!sender.isDestroyed()) sender.send('viewer-template:progress', percent)
    })
  } catch (err) {
    if (err instanceof TemplateMismatchError) {
      throw new Error(ko
        ? `내려받은 파일이 이 버전(${manifest.version})의 무설치판과 일치하지 않아 사용하지 않았습니다.`
        : `The downloaded file is not this version's (${manifest.version}) portable, so it was not used.`, { cause: err })
    }
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(ko ? `원본 프로그램을 내려받지 못했습니다 (${reason}).` : `Could not download the portable (${reason}).`, { cause: err })
  } finally {
    owner?.setProgressBar(-1)
  }
}

async function extractEmbeddedDocument(): Promise<EmbeddedDocument | null> {
  // Only the portable SFX entry point carries embedded documents — the NSIS
  // app never has bytes appended to its own exe. Skip when not portable.
  const exeFile = process.env['PORTABLE_EXECUTABLE_FILE']
  if (!exeFile) return null

  // IMPORTANT: read ONLY the trailer (and the embedded document, if any) —
  // never the whole exe. The portable exe is >140 MB, and a synchronous
  // full-file read here blocks the main-process event loop (including the
  // app:// protocol handler that serves the renderer), leaving the window on a
  // blank background for seconds while the OS/antivirus scans the read. The
  // common case (nothing appended) costs a single 22-byte read.
  let handle: Awaited<ReturnType<typeof fs.promises.open>> | null = null
  try {
    const stat = await fs.promises.stat(exeFile)
    if (stat.size < EMBED_FOOTER_BYTES) return null

    handle = await fs.promises.open(exeFile, 'r')
    const footer = Buffer.allocUnsafe(EMBED_FOOTER_BYTES)
    await readExactly(handle, footer, stat.size - EMBED_FOOTER_BYTES)
    const at = locateEmbedded(stat.size, footer)
    if (!at) return null

    const bytes = Buffer.alloc(at.size)   // dedicated ArrayBuffer (exact size for IPC transfer)
    await readExactly(handle, bytes, at.offset)
    let name: Buffer | null = null
    if (at.name) {
      name = Buffer.alloc(at.name.length)
      await readExactly(handle, name, at.name.offset)
    }
    const doc = acceptEmbedded(bytes, name)
    if (doc) console.log('[WZ Reader] Embedded document detected —', doc.name, at.size, 'bytes')
    return doc
  } catch (err) {
    console.warn('[WZ Reader] extractEmbeddedDocument failed:', err)
    return null
  } finally {
    await handle?.close()
  }
}

// ── IPC: export-exe ─────────────────────────────────────────────────────────
// ── Office → PDF ──────────────────────────────────────────────────────────
// Prints the renderer's own page to PDF. The renderer has already put the
// document into #wz-print-root with its @page rules (src/services/officePdf.ts);
// this only asks Chromium to lay that out on paper. Nothing here takes a path or
// options from the renderer: the page size and margins come from that page's
// CSS (`preferCSSPageSize`), and the bytes go back to be saved where the reader
// picks. Text stays text — selectable and searchable in the result.
ipcMain.handle('print-to-pdf', async (event) => {
  assertTrustedIpcSender(event)
  const pdf = await event.sender.printToPDF({
    preferCSSPageSize: true,
    printBackground: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  })
  return pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength)
})

// ── A deck saved as a narrated video (electron/videoSave.ts) ─────────────
// Asked first, before the video is made, so the reader names the file while
// the click is still theirs; the chosen path stays here behind a token.
const videoSaves = new PendingVideoSaves()
ipcMain.handle('video:pick', async (event, suggestedName: unknown) => {
  assertTrustedIpcSender(event)
  const win = BrowserWindow.fromWebContents(event.sender)
  const korean = app.getLocale().startsWith('ko')
  const options = {
    title: korean ? '발표 동영상 저장' : 'Save narrated video',
    defaultPath: cleanSuggestedName(suggestedName),
    filters: [{ name: korean ? 'MP4 동영상' : 'MP4 video', extensions: ['mp4'] }],
  }
  const { canceled, filePath } = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return null
  const mp4 = /\.mp4$/i.test(filePath) ? filePath : `${filePath}.mp4`
  return { token: videoSaves.add(mp4), name: path.basename(mp4) }
})
// Making a video takes minutes, and the reader goes on to other windows. A
// hidden window is throttled hard — a one-second timer measured 4.75 s and the
// export ran about ten times slower — so the renderer asks to be left at full
// speed for the length of the job, and gives it back afterwards. The speech
// engine is raised with it: Windows moves an app's work that is not in front
// onto slower cores, which halved its speed (ttsEngine.ts, setBoost).
ipcMain.handle('background-work', async (event, on: unknown) => {
  assertTrustedIpcSender(event)
  if (typeof on !== 'boolean') throw new Error('Invalid background-work flag')
  event.sender.setBackgroundThrottling(!on)
  setTtsBoost(on)
})
ipcMain.handle('video:write', async (event, token: unknown, mp4: unknown) => {
  assertTrustedIpcSender(event)
  const target = videoSaves.take(token)
  if (!target) throw new Error('No save location chosen')
  // The dialog already asked before replacing an existing file.
  await fs.promises.writeFile(target, validateMp4(mp4))
  return path.basename(target)
})

// Any document the app opens, carried under its own name — a deck stays a
// deck, a HWP a HWP. The renderer decides which file that is (the original,
// or the PDF "PDF 저장" would write when there are stamps or a password change
// to keep); this side holds it to the rules a file being opened must meet.
ipcMain.handle('export-exe', async (event, data: unknown, rawName: unknown) => {
  assertTrustedIpcSender(event)
  if (!(data instanceof ArrayBuffer)) throw new Error('Invalid document data')
  const docName = cleanEmbeddedName(rawName)
  if (!docName) throw new Error('Not a document this app opens')
  const docBytes = new Uint8Array(data)
  if (!isAcceptableDocument(docName, docBytes)) {
    throw new Error(`Not a valid ${path.extname(docName)} file, or larger than ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB`)
  }

  const found = await findViewerTemplate()
  let baseExe = found.path
  if (!baseExe && found.manifest) {
    try {
      baseExe = await obtainViewerTemplate(event.sender, found.manifest)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
    if (!baseExe) return { success: false, canceled: true }
  }
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
    // Named after the document: the recipient sees "제안서.exe", not a
    // generic viewer they have to open to find out what it is.
    defaultPath: `${path.parse(docName).name || 'WZ_Reader_Viewer'}.exe`,
    filters: [{ name: 'Executable', extensions: ['exe'] }],
  })
  if (canceled || !filePath) return { success: false, canceled: true }

  try {
    if (path.resolve(filePath) === path.resolve(baseExe)) {
      throw new Error('The viewer template cannot overwrite itself')
    }

    // Copy and append asynchronously. The old implementation synchronously
    // read the whole 140MB+ template and then Buffer.concat duplicated it,
    // blocking Electron's main loop and temporarily consuming hundreds of MB.
    await fs.promises.copyFile(baseExe, filePath)
    await fs.promises.appendFile(filePath, docBytes)
    await fs.promises.appendFile(filePath, buildTrailer(docName, docBytes.byteLength))

    const outputSize = (await fs.promises.stat(filePath)).size
    console.log('[WZ Reader] Viewer EXE exported to:', filePath, '— total size:', outputSize)
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
  let target = await assertPublicHttpUrl(rawUrl)
  const startedSecure = target.url.protocol === 'https:'
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  let response: PinnedResponse | null = null

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    // Connected to the address the check vetted, not to a fresh resolution.
    response = await pinnedRequest(target, signal)
    if (![301, 302, 303, 307, 308].includes(response.status)) break

    const location = response.headers.location
    response.body.resume()
    if (!location || redirects === MAX_REDIRECTS) throw new Error('Too many redirects')
    target = await assertPublicHttpUrl(new URL(location, target.url).href)
    // A redirect may not step down from https to http.
    if (startedSecure && target.url.protocol !== 'https:') throw new Error('Insecure redirect')
  }

  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error(`Download failed (HTTP ${response?.status ?? 0})`)
  }

  const contentLength = response.headers['content-length']
  if (contentLength) {
    const declaredBytes = Number(contentLength)
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > MAX_FILE_SIZE) {
      response.body.destroy()
      throw new Error(`File exceeds ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB limit`)
    }
  }

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      totalBytes += chunk.byteLength
      if (totalBytes > MAX_FILE_SIZE) {
        throw new Error(`File exceeds ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB limit`)
      }
      chunks.push(chunk)
    }
  } catch (error) {
    response.body.destroy()
    throw error
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

/**
 * Paths the operating system itself asked us to open (argv, file association,
 * `open-file`). Only these may name a network share: a UNC path makes the main
 * process initiate SMB/WebDAV to whatever host it names, which leaks the
 * user's NTLM challenge-response without any interaction — so a compromised
 * renderer must not be able to point `read-file` at `\\attacker\x.pdf`.
 */
const osProvidedPaths = new Set<string>()
function rememberOsPath(filePath: string): string {
  osProvidedPaths.add(path.resolve(filePath))
  return filePath
}
const isUncPath = (p: string) => /^[\\/]{2}/.test(p)

/**
 * Every check a local document must pass before any of its bytes are read, in
 * one place, so `read-file`, `stat-file` and `read-file-range` cannot drift
 * apart. Returns an open handle the caller must close.
 */
async function openValidatedDocument(filePath: unknown) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('Invalid file path')
  }
  const resolved = path.resolve(filePath)
  if (isUncPath(resolved) && !osProvidedPaths.has(resolved)) {
    throw new Error('Network paths can only be opened from the file manager')
  }
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
    // Stat through the same handle the bytes will be read from.
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Path is not a regular file')
    if (stat.size === 0) throw new Error('File is empty')
    return { handle, size: stat.size, isText: isTextDocumentPath(lowerReal) }
  } catch (err) {
    await handle.close()
    throw err
  }
}

/** Reject a binary document whose first bytes are not a format we open. */
async function assertDocumentSignature(handle: Awaited<ReturnType<typeof fs.promises.open>>): Promise<void> {
  const head = Buffer.alloc(16)
  const { bytesRead } = await handle.read(head, 0, head.length, 0)
  if (!hasSupportedDocumentSignature(head.subarray(0, bytesRead))) {
    throw new Error('File content does not match a supported document format')
  }
}

ipcMain.handle('read-file', async (event, filePath: unknown): Promise<ArrayBuffer> => {
  assertTrustedIpcSender(event)
  const doc = await openValidatedDocument(filePath)
  try {
    if (doc.size > MAX_FILE_SIZE) {
      throw new Error(`File must be between 1 byte and ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB`)
    }
    // Reading exactly the validated size prevents a file that grows
    // concurrently from bypassing the cap.
    // Its own ArrayBuffer of exactly this size, returned as is. Reading into a
    // Buffer and then slicing a "fresh" ArrayBuffer out of it copied the whole
    // document once more — up to 500 MB extra at peak. (Not allocUnsafe +
    // returning `.buffer`: small allocUnsafe buffers share a pool, and the
    // whole pool would go to the renderer.)
    const data = new Uint8Array(doc.size)
    await readExactly(doc.handle, data, 0)
    // Markdown and mail are plain text and have no signature to verify —
    // see TEXT_DOCUMENT_EXTENSIONS in security.ts for why that is sound here.
    if (!doc.isText && !hasSupportedDocumentSignature(data)) {
      throw new Error('File content does not match a supported document format')
    }
    return data.buffer
  } finally {
    await doc.handle.close()
  }
})

// ── IPC: large documents, by range ─────────────────────────────────────────
// A document over MAX_DOCUMENT_BYTES is never read whole: the renderer asks
// for its size, then pdfjs asks for the ranges it needs (the cross-reference
// table, then whatever the visible pages draw). Opening a 1.38 GB, 223-page
// PDF this way read 1.7 MB. Both handlers repeat every check `read-file`
// makes, and only binary documents qualify — the text formats are small and
// are parsed whole anyway.
// ── Recent documents ────────────────────────────────────────────────────────
// Listed on the start screen. Paths and times only, in userData; opening one
// goes back through read-file's full validation like any other path.
let recentStore: RecentFilesStore | null = null
function recent(): RecentFilesStore {
  recentStore ??= new RecentFilesStore(path.join(app.getPath('userData'), 'recent-files.json'))
  return recentStore
}
ipcMain.handle('recent:list', async event => {
  assertTrustedIpcSender(event)
  return recent().list()
})
ipcMain.handle('recent:add', async (event, filePath: unknown) => {
  assertTrustedIpcSender(event)
  if (!isRecentCandidate(filePath)) throw new Error('Invalid path')
  return recent().add(filePath)
})
ipcMain.handle('recent:remove', async (event, filePath: unknown) => {
  assertTrustedIpcSender(event)
  if (typeof filePath !== 'string') throw new Error('Invalid path')
  return recent().remove(filePath)
})
ipcMain.handle('recent:clear', async event => {
  assertTrustedIpcSender(event)
  return recent().clear()
})

ipcMain.handle('stat-file', async (event, filePath: unknown): Promise<{ size: number }> => {
  assertTrustedIpcSender(event)
  const doc = await openValidatedDocument(filePath)
  try {
    if (doc.size > MAX_RANGED_DOCUMENT_BYTES) {
      throw new Error(`File exceeds ${Math.round(MAX_RANGED_DOCUMENT_BYTES / 1024 / 1024)}MB limit`)
    }
    if (!doc.isText) await assertDocumentSignature(doc.handle)
    return { size: doc.size }
  } finally {
    await doc.handle.close()
  }
})

ipcMain.handle('read-file-range', async (
  event, filePath: unknown, offset: unknown, length: unknown,
): Promise<ArrayBuffer> => {
  assertTrustedIpcSender(event)
  const doc = await openValidatedDocument(filePath)
  try {
    if (doc.isText) throw new Error('Text documents are read whole')
    if (doc.size > MAX_RANGED_DOCUMENT_BYTES) {
      throw new Error(`File exceeds ${Math.round(MAX_RANGED_DOCUMENT_BYTES / 1024 / 1024)}MB limit`)
    }
    if (!isValidByteRange(offset, length, doc.size)) throw new Error('Invalid byte range')
    // Checked on every call, not once: a renamed binary must not become
    // readable a range at a time just because it was never asked for whole.
    await assertDocumentSignature(doc.handle)
    const data = new Uint8Array(length as number) // see read-file: no extra copy
    await readExactly(doc.handle, data, offset as number)
    return data.buffer
  } finally {
    await doc.handle.close()
  }
})

// ── IPC: text to speech ────────────────────────────────────────────────────
// The weights are not in the installer (383 MB against a 246 MB installer, for
// an opt-in feature), so the renderer asks for their status, triggers the
// one-time download, and then requests audio a chunk at a time. Synthesis runs
// in a utility process — see ttsWorker.ts for why.
let ttsDownload: AbortController | null = null

ipcMain.handle('tts:status', async (event) => {
  assertTrustedIpcSender(event)
  return modelStatus()
})

ipcMain.handle('tts:download', async (event) => {
  assertTrustedIpcSender(event)
  if (ttsDownload) return { ok: false, error: 'A download is already running' }
  const controller = new AbortController()
  ttsDownload = controller
  try {
    await downloadModel(controller.signal, progress => {
      // The window can be gone by the time a chunk lands.
      if (!event.sender.isDestroyed()) {
        event.sender.send('tts:download-progress', progress)
      }
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    ttsDownload = null
  }
})

ipcMain.handle('tts:cancel-download', async (event) => {
  assertTrustedIpcSender(event)
  ttsDownload?.abort()
})

ipcMain.handle('tts:synthesize', async (event, options: unknown) => {
  assertTrustedIpcSender(event)
  // The renderer is the threat model for IPC, so none of this is taken on
  // trust: every field is checked and clamped before it reaches the engine.
  const opts = options as Record<string, unknown>
  const text = typeof opts?.text === 'string' ? opts.text : ''
  if (text.length === 0 || text.length > 2_000) throw new Error('Invalid text')
  if (!isVoiceId(opts.voice)) throw new Error('Invalid voice')
  const lang = typeof opts.lang === 'string' && /^[a-z]{2}$/.test(opts.lang) ? opts.lang : 'en'
  const speed = clamp(Number(opts.speed), 0.5, 2, 1.05)
  const totalStep = Math.round(clamp(Number(opts.totalStep), 1, 32, 8))
  return synthesizeSpeech({ text, voice: opts.voice, lang, speed, totalStep })
})

/** Most sentences one batch may carry; the renderer sends five. */
const MAX_BATCH = 8
ipcMain.handle('tts:synthesize-batch', async (event, options: unknown) => {
  assertTrustedIpcSender(event)
  // Checked like a single sentence, item by item.
  const opts = options as Record<string, unknown>
  const texts = Array.isArray(opts?.texts) ? opts.texts : []
  if (texts.length === 0 || texts.length > MAX_BATCH
    || !texts.every(t => typeof t === 'string' && t.length > 0 && t.length <= 2_000)) throw new Error('Invalid texts')
  const langsIn = Array.isArray(opts.langs) ? opts.langs : []
  const langs = texts.map((_, i) => (typeof langsIn[i] === 'string' && /^[a-z]{2}$/.test(langsIn[i]) ? langsIn[i] as string : 'en'))
  if (!isVoiceId(opts.voice)) throw new Error('Invalid voice')
  const speed = clamp(Number(opts.speed), 0.5, 2, 1.05)
  const totalStep = Math.round(clamp(Number(opts.totalStep), 1, 32, 8))
  return synthesizeSpeechBatch({ texts: texts as string[], langs, voice: opts.voice, speed, totalStep })
})

ipcMain.handle('tts:stop', async (event) => {
  assertTrustedIpcSender(event)
  shutdownTts()
})

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

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
    console.error('[WZ Reader] open-help failed:', msg)
    return { success: false, error: msg }
  }
})

// ── Automatic updates (installed app only) ─────────────────────────────────
// See electron/autoUpdate.ts. Replaces a manifest check against whyzoo.com
// that only opened a download page, and whose manifest stopped at 1.6.5.
registerUpdateIpc(assertTrustedIpcSender)

// (The previous `print-window` IPC used `webContents.print()`, which opens
// the OS system print dialog with no real preview on Windows. The renderer
// now calls `window.print()` directly instead — same Chromium under Electron
// gives us the proper Chrome-style print preview in the desktop app too.)

// ── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Electron's default is to GRANT every permission request — camera,
  // microphone, geolocation, notifications — silently. Only what the viewer
  // itself uses is granted, and only to our own renderer (see
  // `allowsPermission`); refusing everything also refused presentation mode.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) =>
    callback(allowsPermission(permission, details.requestingUrl || wc.getURL(), { devServer: !app.isPackaged })))
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    allowsPermission(permission, requestingOrigin, { devServer: !app.isPackaged }))

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

  // Determine what to open on startup (priority: CLI arg > open-file event > embedded PDF)
  // CLI arg covers both manual launches (`WZ_PDF.exe foo.pdf`) and the OS
  // file-association entry point (double-click a .pdf in Explorer). Known before
  // the window exists, so the renderer can skip the start screen.
  const argFile = findFileArgument(process.argv)

  createWindow({ opening: !!(argFile || pendingFile) })
  startAutoUpdate(() => win)

  if (argFile && win) {
    win.webContents.once('did-finish-load', () => {
      win?.webContents.send('open-file', rememberOsPath(argFile))
    })
  } else if (pendingFile && win) {
    const filePath = pendingFile
    pendingFile = null
    win.webContents.once('did-finish-load', () => {
      win?.webContents.send('open-file', rememberOsPath(filePath))
    })
  } else {
    // Check for a document embedded in this portable exe (viewer-exe mode).
    // Runs asynchronously so it never blocks the window's first paint; the
    // read is a couple of small partial reads instead of the whole exe.
    extractEmbeddedDocument().then(embedded => {
      if (!embedded || !win) return
      const { bytes, name } = embedded
      // An ArrayBuffer of exactly the document (Buffer.alloc gives it its own).
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const send = () => win?.webContents.send('open-embedded-document', buffer, name)
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
      else send()
    }).catch(() => { /* extractEmbeddedDocument already logs; ignore */ })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (win) {
    win.webContents.send('open-file', rememberOsPath(filePath))
  } else {
    pendingFile = filePath
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Every WebContents the app ever creates gets the same three guards. They used
// to be attached to the main window only, which left the hidden CLI converter
// window (pdfCliBackend.ts) free to navigate and to open new windows.
app.on('web-contents-created', (_event, contents) => {
  // Block in-app navigation to any URL except the renderer's own origin.
  // Document content must not be able to navigate the host window.
  contents.on('will-navigate', (event, navUrl) => {
    if (!isOurRenderer(navUrl)) event.preventDefault()
  })
  // A navigation that was allowed must not be bounced elsewhere by a redirect.
  contents.on('will-redirect', (event, navUrl) => {
    if (!isOurRenderer(navUrl)) event.preventDefault()
  })

  // External links (http/https) open in the user's default browser; everything
  // else is blocked. We never open a new Electron window.
  contents.setWindowOpenHandler(({ url }) => {
    try {
      shell.openExternal(parseHttpUrl(url).href).catch(() => { /* ignore */ })
    } catch { /* unsupported or malformed URL */ }
    return { action: 'deny' }
  })

  // Belt-and-suspenders: deny any webview creation app-wide. We don't use
  // <webview> tags, but this prevents abuse if one slipped in.
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
})
