import { app, BrowserWindow, ipcMain } from 'electron'
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

  win.on('closed', () => { win = null })
}

app.whenReady().then(() => {
  createWindow()

  // Windows: file path via process.argv
  const argFile = process.argv.find(arg => arg.endsWith('.pdf'))
  if (argFile && win) {
    win.webContents.once('did-finish-load', () => {
      win?.webContents.send('open-file', argFile)
    })
  }

  // Send pending file from open-file event (macOS)
  if (pendingFile && win) {
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

// Suppress unused import warning — ipcMain reserved for future use
void ipcMain
