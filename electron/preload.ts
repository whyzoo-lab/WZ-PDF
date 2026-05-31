import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // ── File opening ────────────────────────────────────────────────────────
  /** Called when the OS asks the app to open a file (CLI arg / file association). */
  onOpenFile: (callback: (filePath: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, filePath: string) => callback(filePath)
    ipcRenderer.on('open-file', handler)
    return () => ipcRenderer.removeListener('open-file', handler)
  },

  /**
   * Called when the app was launched as a viewer-exe (PDF embedded inside the exe).
   * The bytes are sent once, right after the renderer finishes loading.
   */
  onOpenPdfBytes: (callback: (bytes: ArrayBuffer) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, bytes: ArrayBuffer) => callback(bytes)
    ipcRenderer.on('open-pdf-bytes', handler)
    return () => ipcRenderer.removeListener('open-pdf-bytes', handler)
  },

  // ── File reading ────────────────────────────────────────────────────────
  /** Read a local file by absolute path (avoids fetch('file://') CORS restriction). */
  readFile: (filePath: string): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('read-file', filePath),

  // ── Export EXE ──────────────────────────────────────────────────────────
  /**
   * Export the current PDF as a standalone viewer exe.
   * Copies the running portable exe and appends the PDF bytes to it.
   * Only works in the packaged portable build (PORTABLE_EXECUTABLE_FILE must be set).
   */
  exportExe: (pdfData: ArrayBuffer): Promise<{
    success: boolean
    canceled?: boolean
    outputPath?: string
    error?: string
  }> => ipcRenderer.invoke('export-exe', pdfData),

  // ── Print ───────────────────────────────────────────────────────────────
  /** Invoke the native OS print dialog. */
  printWindow: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('print-window'),

  // ── Help ────────────────────────────────────────────────────────────────
  /** Open the help document in the user's default browser (lang: 'ko' | 'en'). */
  openHelp: (lang?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-help', lang),
})
