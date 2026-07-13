import { app, ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs'

// ── Embedded PDF (viewer-exe mode) ─────────────────────────────────────────
//
// When the user exports a PDF as a standalone viewer exe, we:
//   1. Locate a portable SFX template (see findViewerTemplate below)
//   2. Append: [PDF bytes] [4-byte length UInt32LE] [EMBED_MARKER]
//
// On startup the app reads the original exe, detects the marker, and sends
// the PDF bytes to the renderer so they are loaded automatically.

const EMBED_MARKER = Buffer.from('WZPDF_VIEWER_V01')  // 16 bytes
const EMBED_FOOTER  = 4 + EMBED_MARKER.length          // UInt32LE length + marker = 20 bytes

/**
 * Find the portable-SFX template to use as the viewer EXE base.
 *
 * Two scenarios:
 *
 * 1. Running from the portable exe itself — `PORTABLE_EXECUTABLE_FILE` is
 *    set by electron-builder and points to the running SFX. Use that.
 *
 * 2. Running from the NSIS-installed app — no env var, but the installer
 *    bundled the portable as `<resources>/viewer-template.exe` via the
 *    afterPack hook. Use that.
 *
 * Returns `null` in dev mode (no template available; the feature is gated
 * on `window.electronAPI` in the renderer anyway).
 */
function findViewerTemplate(): string | null {
  const portableEnv = process.env['PORTABLE_EXECUTABLE_FILE']
  if (portableEnv && fs.existsSync(portableEnv)) {
    return portableEnv
  }

  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'viewer-template.exe')
    if (fs.existsSync(bundled)) {
      return bundled
    }
  }

  return null
}

export async function extractEmbeddedPdf(): Promise<Buffer | null> {
  // Only the portable SFX entry point carries embedded PDFs — the NSIS app
  // never has bytes appended to its own exe. Skip when not portable.
  const exeFile = process.env['PORTABLE_EXECUTABLE_FILE']
  if (!exeFile) return null

  // IMPORTANT: read ONLY the 20-byte footer (and the embedded PDF, if any) —
  // never the whole exe. The portable exe is >140 MB, and a synchronous
  // full-file read here blocks the main-process event loop (including the
  // app:// protocol handler that serves the renderer), leaving the window on a
  // blank background for seconds while the OS/antivirus scans the read. The
  // common case (no PDF appended) now costs a single 20-byte read.
  let handle: Awaited<ReturnType<typeof fs.promises.open>> | null = null
  try {
    const stat = await fs.promises.stat(exeFile)
    if (stat.size < EMBED_FOOTER) return null

    handle = await fs.promises.open(exeFile, 'r')

    // Footer layout (last 20 bytes): [pdfSize UInt32LE (4)] [EMBED_MARKER (16)]
    const footer = Buffer.allocUnsafe(EMBED_FOOTER)
    await handle.read(footer, 0, EMBED_FOOTER, stat.size - EMBED_FOOTER)
    if (!footer.subarray(4).equals(EMBED_MARKER)) return null

    const pdfSize = footer.readUInt32LE(0)
    if (pdfSize === 0) return null
    const pdfOffset = stat.size - EMBED_FOOTER - pdfSize
    if (pdfOffset < 0) return null

    const pdf = Buffer.alloc(pdfSize)   // dedicated ArrayBuffer (exact size for IPC transfer)
    await handle.read(pdf, 0, pdfSize, pdfOffset)
    console.log('[WZ PDF] Embedded PDF detected — size:', pdfSize, 'bytes')
    return pdf
  } catch (err) {
    console.warn('[WZ PDF] extractEmbeddedPdf failed:', err)
    return null
  } finally {
    await handle?.close()
  }
}

// ── IPC: export-exe ─────────────────────────────────────────────────────────
export function registerExportExeIpc() {
  ipcMain.handle('export-exe', async (_event, pdfData: ArrayBuffer) => {
    const baseExe = findViewerTemplate()
    if (!baseExe) {
      return {
        success: false,
        error:
          'EXE Viewer 템플릿을 찾을 수 없습니다.\n\n' +
          '개발 모드에서는 이 기능을 사용할 수 없습니다.\n' +
          'npm run build:exe 로 빌드한 뒤 실행해주세요.',
      }
    }

    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Viewer EXE로 저장',
      defaultPath: 'WZ_PDF_Viewer.exe',
      filters: [{ name: 'Executable', extensions: ['exe'] }],
    })
    if (canceled || !filePath) return { success: false, canceled: true }

    try {
      const exeBytes  = fs.readFileSync(baseExe)
      const pdfBytes  = Buffer.from(pdfData)
      const sizeBytes = Buffer.allocUnsafe(4)
      sizeBytes.writeUInt32LE(pdfBytes.length)

      const output = Buffer.concat([exeBytes, pdfBytes, sizeBytes, EMBED_MARKER])
      fs.writeFileSync(filePath, output)

      console.log('[WZ PDF] Viewer EXE exported to:', filePath, '— total size:', output.length)
      return { success: true, outputPath: filePath }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `저장 실패: ${msg}` }
    }
  })
}
