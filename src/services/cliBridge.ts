/**
 * Renderer half of the `hwp2pdf` console tool.
 *
 * The conversion cannot run in the main process: `@rhwp/core` renders into an
 * HTMLCanvasElement and `exportHwpToPdf` composites those canvases, so the whole
 * pipeline needs a DOM. The CLI therefore opens the ordinary app page in a
 * hidden window and drives it from here — which also means the file it produces
 * is byte-for-byte the same work as "Export → PDF" in the GUI, including the
 * invisible selectable-text layer and the bundled Korean fonts.
 *
 * Installed only when the page is loaded with `?cli=1`, and every heavy module
 * is imported inside the call, so a normal launch pays nothing for this.
 */

/** Base64 in fixed-size chunks; one `String.fromCharCode(...bytes)` on a
 *  multi-megabyte PDF overflows the argument limit and throws. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export interface CliBridge {
  /** Load the engine and fonts once, so the first file is not billed for them. */
  warmup(): Promise<void>
  /** Convert one HWP/HWPX file and return the PDF as base64. */
  convert(filePath: string): Promise<string>
}

export function installCliBridge(): void {
  const bridge: CliBridge = {
    async warmup(): Promise<void> {
      // The Korean fallback fonts alone are ~12 MB, and the WASM engine and
      // pdf-lib arrive as their own chunks. Paid once, up front, rather than
      // inside the first file's conversion budget — which is how a perfectly
      // good document ended up reported as a timeout.
      const [{ ensureKoreanFonts }] = await Promise.all([
        import('./hwpFonts'),
        import('./hwpEngine'),
        import('./hwpDocAdapter'),
        import('./pdfExporter'),
      ])
      await ensureKoreanFonts()
    },

    async convert(filePath: string): Promise<string> {
      const bytes = await window.electronAPI!.readFile(filePath)
      const [{ loadHwp }, { createHwpViewerDoc }, { exportHwpToPdf }] = await Promise.all([
        import('./hwpEngine'),
        import('./hwpDocAdapter'),
        import('./pdfExporter'),
      ])
      const doc = createHwpViewerDoc(await loadHwp(bytes))
      try {
        // No annotations: a conversion has no markup to bake in.
        return toBase64(await exportHwpToPdf(doc, []))
      } finally {
        doc.destroy()
      }
    },
  }
  ;(window as unknown as { __wzCli?: CliBridge }).__wzCli = bridge
}
