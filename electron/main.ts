import { app, BrowserWindow } from 'electron'
import path from 'path'

let win: BrowserWindow | null = null
let pendingFile: string | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Dev: load Vite dev server
  win.loadURL('http://localhost:5173')

  // Open DevTools so we can see console output while debugging render issues
  win.webContents.openDevTools()

  win.on('closed', () => { win = null })
}

app.whenReady().then(() => {
  createWindow()

  // Windows: file path via process.argv (mutually exclusive with macOS open-file)
  const argFile = process.argv.find(arg => arg.endsWith('.pdf'))
  if (argFile && win) {
    win.webContents.once('did-finish-load', () => {
      win?.webContents.send('open-file', argFile)
    })
  } else if (pendingFile && win) {
    // macOS: open-file event fired before app was ready
    const filePath = pendingFile
    pendingFile = null
    win.webContents.once('did-finish-load', () => {
      win?.webContents.send('open-file', filePath)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// macOS: file association fires before or after app ready
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
