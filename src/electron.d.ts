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

    /** Fetch the version manifest via the main process (avoids CORS). null on error. */
    checkUpdate: () => Promise<UpdateManifest | null>

    /** Open the download page (validated to the update host) in the default browser. */
    openDownload: (url?: string) => Promise<{ success: boolean }>
  }
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
