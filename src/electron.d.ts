interface RecentFileEntry {
  path: string
  /** When it was last opened, ms since the epoch. */
  openedAt: number
}

interface Window {
  electronAPI?: {
    /** Called when the OS asks the app to open a file (CLI / file association). */
    onOpenFile: (callback: (filePath: string) => void) => () => void

    /**
     * Called once on startup when the app detects a PDF embedded inside the
     * portable exe (viewer-exe mode). The ArrayBuffer can be used directly.
     */
    /** The document a viewer exe carries, with its own file name. */
    onOpenEmbeddedDocument: (callback: (bytes: ArrayBuffer, name: string) => void) => () => void

    /** Read a local file by path — avoids fetch('file://') CORS issues. */
    readFile: (filePath: string) => Promise<ArrayBuffer>

    /** Size of a local document, after the same checks `readFile` makes. */
    statFile: (filePath: string) => Promise<{ size: number }>

    /** One byte range of a local document — how a file too large to hold is paged in. */
    readFileRange: (filePath: string, offset: number, length: number) => Promise<ArrayBuffer>

    /** Path of a picked or dropped file; empty when it did not come from disk. */
    pathForFile?: (file: File) => string

    /** Recent documents for the start screen (paths and times only). */
    recentFiles?: () => Promise<RecentFileEntry[]>
    addRecentFile?: (filePath: string) => Promise<RecentFileEntry[]>
    removeRecentFile?: (filePath: string) => Promise<RecentFileEntry[]>
    clearRecentFiles?: () => Promise<RecentFileEntry[]>

    /** Download a PDF from an http(s) URL via the main process (bypasses CORS). */
    fetchUrl: (url: string) => Promise<ArrayBuffer>

    /**
     * Export the current PDF as a standalone viewer exe.
     * Appends the PDF bytes to a copy of the running portable exe.
     * Only works when running the packaged portable build.
     */
    /** Percent of the Viewer EXE template downloaded on the first export. */
    onViewerTemplateProgress?: (callback: (percent: number) => void) => () => void
    /** This page, laid out for print, as PDF bytes (Office → PDF). */
    printToPdf?: () => Promise<ArrayBuffer>
    /** Keep running at full speed while hidden (true) for a long job, then stop (false). */
    setBackgroundWork?: (on: boolean) => Promise<void>
    /** Narrated video: name the .mp4 (null if cancelled), then write it there. */
    pickVideoPath?: (suggestedName: string) => Promise<{ token: string; name: string } | null>
    writeVideoFile?: (token: string, mp4: Uint8Array) => Promise<string>
    /** Write a viewer exe carrying this document under `name`. */
    exportExe: (data: ArrayBuffer, name: string) => Promise<{
      success: boolean
      canceled?: boolean
      outputPath?: string
      error?: string
    }>

    // printWindow removed — renderer uses window.print() directly to get the
    // Chrome-style print-preview UI in the desktop app.

    /** Open the help document in the user's default browser (lang: 'ko' | 'en'). */
    openHelp: (lang?: string) => Promise<{ success: boolean; error?: string }>

    // ── Text to speech ──────────────────────────────────────────────────
    // The weights are not bundled (383 MB, opt-in feature), so the renderer
    // checks for them, triggers the one-time download, then asks for audio a
    // chunk at a time. Synthesis runs in a utility process, not here.

    /** Whether the speech model is on disk, and how much of it. */
    ttsStatus: () => Promise<TtsModelStatus>

    /** Download the speech model. Resolves when every file is present. */
    ttsDownload: () => Promise<{ ok: boolean; error?: string }>

    /** Abort a download in progress; files already finished are kept. */
    ttsCancelDownload: () => Promise<void>

    /** Progress for the download above, roughly once per megabyte. */
    onTtsDownloadProgress: (
      callback: (progress: TtsDownloadProgress) => void,
    ) => () => void

    /** Synthesize one chunk. Returns mono PCM at the returned sample rate. */
    ttsSynthesize: (options: {
      text: string
      voice: string
      lang: string
      speed: number
      totalStep: number
    }) => Promise<{ pcm: Float32Array; sampleRate: number }>

    /** Several sentences in one pass of the model — for a narrated video. */
    ttsSynthesizeBatch?: (options: {
      texts: string[]
      langs: string[]
      voice: string
      speed: number
      totalStep: number
    }) => Promise<{ pcms: Float32Array[]; sampleRate: number }>

    /** Stop the engine and release its memory (~570 MB) right away. */
    ttsStop: () => Promise<void>

    /** Automatic updates (installed app only). Absent in the web build. */
    updateState?: () => Promise<UpdateState>
    /** Turn automatic updates on or off. Resolves with the new state. */
    setAutoUpdate?: (enabled: boolean) => Promise<UpdateState>
    /** Quit, install the downloaded update silently and relaunch. */
    installUpdate?: () => Promise<boolean>
    /** A newer version finished downloading. Returns an unsubscribe function. */
    onUpdateReady?: (callback: (version: string) => void) => () => void
  }
}

/** Presence of the Supertonic weights in userData. */
interface TtsModelStatus {
  /** Every file present at its exact expected size. */
  ready: boolean
  bytesPresent: number
  bytesTotal: number
  dir: string
}

interface TtsDownloadProgress {
  bytesReceived: number
  bytesTotal: number
  /** The file currently being fetched; empty once finished. */
  file: string
}

/** Shape of https://whyzoo.com/WzPDF/version.php */
/** Mirrors UpdateState in electron/autoUpdate.ts. */
interface UpdateState {
  /** False for the portable exe, a viewer exe and development runs. */
  supported: boolean
  enabled: boolean
  /** Version downloaded and waiting to be installed, or null. */
  ready: string | null
  /** The running version. */
  current: string
}

/** App version, injected at build time from package.json via Vite's `define`. */
declare const __APP_VERSION__: string

interface Uint8Array {
  toHex(): string
}

interface Map<K, V> {
  getOrInsertComputed(key: K, fn: (key: K) => V): V
}
