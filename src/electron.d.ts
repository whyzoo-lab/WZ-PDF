interface Window {
  electronAPI?: {
    /** Called when the OS asks the app to open a file (CLI / file association). */
    onOpenFile: (callback: (filePath: string) => void) => () => void

    /**
     * Called once on startup when the app detects a PDF embedded inside the
     * portable exe (viewer-exe mode). The ArrayBuffer can be used directly.
     */
    onOpenPdfBytes: (callback: (bytes: ArrayBuffer) => void) => () => void

    /** Read a local file by path — avoids fetch('file://') CORS issues. */
    readFile: (filePath: string) => Promise<ArrayBuffer>

    /** Download a PDF from an http(s) URL via the main process (bypasses CORS). */
    fetchUrl: (url: string) => Promise<ArrayBuffer>

    /**
     * Export the current PDF as a standalone viewer exe.
     * Appends the PDF bytes to a copy of the running portable exe.
     * Only works when running the packaged portable build.
     */
    exportExe: (pdfData: ArrayBuffer) => Promise<{
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

    /** Stop the engine and release its memory (~570 MB) right away. */
    ttsStop: () => Promise<void>

    /** Fetch the version manifest via the main process (avoids CORS). null on error. */
    checkUpdate: () => Promise<UpdateManifest | null>

    /** Open the download page (validated to the update host) in the default browser. */
    openDownload: (url?: string) => Promise<{ success: boolean }>
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
interface UpdateManifest {
  product?: string
  available?: boolean
  version?: string
  filename?: string
  size_bytes?: number
  released_at?: string
  download_url?: string
  file_url?: string
}

/** App version, injected at build time from package.json via Vite's `define`. */
declare const __APP_VERSION__: string

interface Uint8Array {
  toHex(): string
}

interface Map<K, V> {
  getOrInsertComputed(key: K, fn: (key: K) => V): V
}
