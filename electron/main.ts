import { app, BrowserWindow, Menu, protocol } from 'electron'
import { installCsp } from './csp'
import { serveAppProtocol } from './appProtocol'
import { createWindow } from './window'
import { extractEmbeddedPdf, registerExportExeIpc } from './viewerExe'
import { registerIpcHandlers } from './ipc'

let win: BrowserWindow | null = null
let pendingFile: string | null = null

// ── Custom app:// scheme for the packaged renderer ──────────────────────────
// The packaged app cannot load the renderer from file://: PaddleOCR.js (and
// onnxruntime-web) refuse to run under a file: origin — they require an
// http(s)/app origin so model assets can be fetched. We register a privileged
// `app://` scheme (standard + secure + fetch-enabled, so it behaves like a
// normal web origin for fetch() and CSP 'self') and serve the Vite build from
// it. Registration MUST happen at module load, before `app.whenReady()`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  },
])

// ── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  installCsp()
  if (app.isPackaged) serveAppProtocol()
  registerIpcHandlers()
  registerExportExeIpc()
  Menu.setApplicationMenu(null)
  win = createWindow(() => { win = null })

  // Determine what to open on startup (priority: CLI arg > open-file event > embedded PDF)
  // CLI arg covers both manual launches (`WZ_PDF.exe foo.pdf`) and the OS
  // file-association entry point (double-click a .pdf in Explorer).
  const argFile = process.argv.find(arg => /\.(pdf|hwp|hwpx)$/i.test(arg))

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
    // a couple of small partial reads instead of the whole exe.
    extractEmbeddedPdf().then(embedded => {
      if (!embedded || !win) return
      // Send as a transferable ArrayBuffer so the renderer can use it directly.
      const send = () => win?.webContents.send('open-pdf-bytes', embedded.buffer)
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
      else send()
    }).catch(() => { /* extractEmbeddedPdf already logs; ignore */ })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow(() => { win = null })
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
