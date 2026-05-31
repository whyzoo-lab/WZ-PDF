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

    /** Open the native OS print dialog. */
    printWindow: () => Promise<{ success: boolean; error?: string }>

    /** Open the help document in the user's default browser (lang: 'ko' | 'en'). */
    openHelp: (lang?: string) => Promise<{ success: boolean; error?: string }>
  }
}

/** App version, injected at build time from package.json via Vite's `define`. */
declare const __APP_VERSION__: string

interface Uint8Array {
  toHex(): string
}

interface Map<K, V> {
  getOrInsertComputed(key: K, fn: (key: K) => V): V
}
