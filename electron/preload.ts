import { contextBridge, ipcRenderer, webUtils } from 'electron'

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

  /** Size of a local document, after the same checks `readFile` makes. */
  statFile: (filePath: string): Promise<{ size: number }> =>
    ipcRenderer.invoke('stat-file', filePath),

  /**
   * One byte range of a local document. This is how a file too large to hold
   * reaches pdfjs: it asks for the ranges it needs instead of the whole file.
   */
  readFileRange: (filePath: string, offset: number, length: number): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('read-file-range', filePath, offset, length),

  /**
   * The path of a file the user picked or dropped, so it can be listed under
   * recent documents. Empty for files that did not come from disk.
   */
  pathForFile: (file: File): string => {
    try { return webUtils.getPathForFile(file) } catch { return '' }
  },

  /** Recent documents for the start screen: list, record one, forget one or all. */
  recentFiles: (): Promise<{ path: string; openedAt: number }[]> => ipcRenderer.invoke('recent:list'),
  addRecentFile: (filePath: string): Promise<{ path: string; openedAt: number }[]> => ipcRenderer.invoke('recent:add', filePath),
  removeRecentFile: (filePath: string): Promise<{ path: string; openedAt: number }[]> => ipcRenderer.invoke('recent:remove', filePath),
  clearRecentFiles: (): Promise<{ path: string; openedAt: number }[]> => ipcRenderer.invoke('recent:clear'),

  /** Download a PDF from an http(s) URL via the main process (bypasses CORS). */
  fetchUrl: (url: string): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('fetch-url', url),

  // ── Export EXE ──────────────────────────────────────────────────────────
  /**
   * Export the current PDF as a standalone viewer exe.
   * Copies the running portable exe and appends the PDF bytes to it.
   * Only works in the packaged portable build (PORTABLE_EXECUTABLE_FILE must be set).
   */
  /** Percent of the Viewer EXE template downloaded, while the first export fetches it. */
  onViewerTemplateProgress: (callback: (percent: number) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, percent: unknown) => {
      if (typeof percent === 'number') callback(percent)
    }
    ipcRenderer.on('viewer-template:progress', handler)
    return () => ipcRenderer.removeListener('viewer-template:progress', handler)
  },
  exportExe: (pdfData: ArrayBuffer): Promise<{
    success: boolean
    canceled?: boolean
    outputPath?: string
    error?: string
  }> => ipcRenderer.invoke('export-exe', pdfData),

  // (No print IPC: the renderer calls window.print() directly so the Chrome
  // print-preview UI shows up in the desktop app instead of the OS dialog.)

  /**
   * This page, as laid out for print, as PDF bytes — how Word, PowerPoint and
   * spreadsheets are saved as PDF (see src/services/officePdf.ts).
   */
  printToPdf: (): Promise<ArrayBuffer> => ipcRenderer.invoke('print-to-pdf'),

  // ── Help ────────────────────────────────────────────────────────────────
  /** Open the help document in the user's default browser (lang: 'ko' | 'en'). */
  openHelp: (lang?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-help', lang),

  // ── Text to speech ────────────────────────────────────────────────────────
  /** Whether the speech model is on disk, and how much of it. */
  ttsStatus: (): Promise<{
    ready: boolean
    bytesPresent: number
    bytesTotal: number
    dir: string
  }> => ipcRenderer.invoke('tts:status'),

  /** Download the speech model. Resolves when every file is present. */
  ttsDownload: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('tts:download'),

  /** Abort a download in progress; the files already finished are kept. */
  ttsCancelDownload: (): Promise<void> => ipcRenderer.invoke('tts:cancel-download'),

  /** Progress for the download above, roughly once per megabyte. */
  onTtsDownloadProgress: (
    callback: (progress: { bytesReceived: number; bytesTotal: number; file: string }) => void,
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: {
      bytesReceived: number; bytesTotal: number; file: string
    }) => callback(progress)
    ipcRenderer.on('tts:download-progress', handler)
    return () => ipcRenderer.removeListener('tts:download-progress', handler)
  },

  /** Synthesize one chunk of text. Returns mono PCM in the given sample rate. */
  ttsSynthesize: (options: {
    text: string
    voice: string
    lang: string
    speed: number
    totalStep: number
  }): Promise<{ pcm: Float32Array; sampleRate: number }> =>
    ipcRenderer.invoke('tts:synthesize', options),

  /** Stop the engine and release its memory (~570 MB) right away. */
  ttsStop: (): Promise<void> => ipcRenderer.invoke('tts:stop'),

  // ── Automatic updates (installed app only; see electron/autoUpdate.ts) ────
  /** Whether this copy updates itself, whether it is on, and any update waiting. */
  updateState: (): Promise<unknown> => ipcRenderer.invoke('update:state'),
  /** Turn automatic updates on or off. Resolves with the new state. */
  setAutoUpdate: (enabled: boolean): Promise<unknown> => ipcRenderer.invoke('update:set-enabled', enabled),
  /** Quit, install the downloaded update silently and relaunch. */
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke('update:install'),
  /** A newer version finished downloading. Returns an unsubscribe function. */
  onUpdateReady: (callback: (version: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, version: unknown) => {
      if (typeof version === 'string') callback(version)
    }
    ipcRenderer.on('update:ready', handler)
    return () => ipcRenderer.removeListener('update:ready', handler)
  },
})
