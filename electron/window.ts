import { app, BrowserWindow, shell } from 'electron'
import path from 'path'

/**
 * Create the main application window. Returns the BrowserWindow; the caller owns
 * the module-level singleton and passes `onClosed` to null it out (keeping the
 * singleton in main.ts avoids a stale reference after the window is destroyed).
 */
export function createWindow(onClosed: () => void): BrowserWindow {
  const win = new BrowserWindow({
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

  win.on('closed', onClosed)
  return win
}
