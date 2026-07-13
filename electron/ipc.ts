import { app, ipcMain, shell, net } from 'electron'
import path from 'path'
import fs from 'fs'

// ── Security limits ────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 500 * 1024 * 1024  // 500 MB — defensive cap on read-file / fetch-url

// ── Optional update check ───────────────────────────────────────────────────
const UPDATE_MANIFEST_URL = 'https://whyzoo.com/WzPDF/version.php'
const UPDATE_HOST_PREFIX = 'https://whyzoo.com/'

/** Returns true if the lower-cased path ends with one of the allowed document extensions. */
function isAllowedDocExtension(lowerPath: string): boolean {
  return lowerPath.endsWith('.pdf') || lowerPath.endsWith('.hwp') || lowerPath.endsWith('.hwpx')
}

/**
 * Register the renderer-facing IPC handlers (all read-only / navigational; the
 * export-exe handler lives in viewerExe.ts). Call once, before the window loads.
 */
export function registerIpcHandlers() {
  // ── IPC: fetch-url ───────────────────────────────────────────────────────
  // Download a PDF from an http(s) URL in the main process. Unlike the renderer,
  // the main process isn't bound by CORS, so this works for any reachable host.
  // Hardened: only http/https, follows the same MAX_FILE_SIZE cap, and verifies
  // the response looks like a PDF.
  ipcMain.handle('fetch-url', async (_event, rawUrl: unknown): Promise<ArrayBuffer> => {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
      throw new Error('Invalid URL')
    }
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      throw new Error('Malformed URL')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Only http(s) URLs are allowed')
    }
    const res = await fetch(url.href, { redirect: 'follow' })
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`)

    const len = Number(res.headers.get('content-length') ?? '0')
    if (len > MAX_FILE_SIZE) {
      throw new Error(`File exceeds ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB limit`)
    }
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_FILE_SIZE) {
      throw new Error(`File exceeds ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB limit`)
    }
    // Sanity-check magic bytes for supported document types:
    //   PDF  → starts with '%PDF' (0x25 0x50 0x44 0x46)
    //   HWP  → OLE2 compound-doc header (D0 CF 11 E0 A1 B1 1A E1)
    //   HWPX → ZIP archive (50 4B 03 04) — HWPX is a zipped XML format
    // Renderer-side detectDocType still does the authoritative routing; this
    // check just prevents the IPC from rejecting valid HWP/HWPX bytes.
    const head = new Uint8Array(buf.slice(0, 8))
    const isPdf  = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46
    const isHwp  = head[0] === 0xD0 && head[1] === 0xCF && head[2] === 0x11 && head[3] === 0xE0 &&
                   head[4] === 0xA1 && head[5] === 0xB1 && head[6] === 0x1A && head[7] === 0xE1
    const isHwpx = head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04
    if (!isPdf && !isHwp && !isHwpx) {
      throw new Error('The URL did not return a PDF, HWP, or HWPX file')
    }
    return buf
  })

  // ── IPC: read-file ─────────────────────────────────────────────────────────
  // Renderer cannot fetch('file://') from an http://localhost origin (CORS).
  // This handler lets the renderer ask the main process to read a file for it.
  //
  // Defense-in-depth: even though the path normally comes from the OS (CLI arg
  // or open-file event), a compromised renderer must not be able to read
  // arbitrary files on disk. We enforce: non-empty string, allowed extension,
  // real regular file (symlinks resolved), size below MAX_FILE_SIZE.
  ipcMain.handle('read-file', async (_event, filePath: unknown): Promise<ArrayBuffer> => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new Error('Invalid file path')
    }
    const resolved = path.resolve(filePath)
    if (!isAllowedDocExtension(resolved.toLowerCase())) {
      throw new Error('Only .pdf, .hwp, and .hwpx files are allowed')
    }
    // Resolve symlinks before any check: a `foo.pdf` symlink pointing at
    // /etc/shadow would otherwise pass the extension test and leak the target.
    // We validate the REAL path's extension + that it's a regular file.
    const real = await fs.promises.realpath(resolved)
    if (!isAllowedDocExtension(real.toLowerCase())) {
      throw new Error('Resolved path is not a .pdf, .hwp, or .hwpx file')
    }
    const stat = await fs.promises.lstat(real)
    if (!stat.isFile()) {
      throw new Error('Path is not a regular file')
    }
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(`File exceeds ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB limit`)
    }
    const data = await fs.promises.readFile(real)
    // Return a fresh ArrayBuffer slice (Buffer view → standalone ArrayBuffer)
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  })

  // ── IPC: open-help ─────────────────────────────────────────────────────────
  // Opens `help.html` (shipped alongside the renderer build) in the user's
  // default browser via shell.openExternal. Reachable from F1 in the renderer.
  ipcMain.handle('open-help', async (_event, lang?: unknown) => {
    try {
      // Korean → help.html, anything else → help.en.html. Validate the arg so a
      // compromised renderer can't smuggle an arbitrary filename into the path.
      const helpFile = lang === 'ko' ? 'help.html' : 'help.en.html'
      let url: string
      if (app.isPackaged) {
        // dist/<helpFile> is copied from public/ during vite build
        const helpPath = path.join(__dirname, '..', 'dist', helpFile)
        // file:// URL with forward slashes works on all platforms
        url = 'file:///' + helpPath.replace(/\\/g, '/')
      } else {
        url = `http://localhost:5173/${helpFile}`
      }
      await shell.openExternal(url)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[WZ PDF] open-help failed:', msg)
      return { success: false, error: msg }
    }
  })

  // ── IPC: check-update ───────────────────────────────────────────────────────
  // The renderer asks the main process (no CORS) to read the version manifest;
  // it compares against the running version and shows a dismissible toast. The
  // download is opened in the user's browser — we never auto-install.
  ipcMain.handle('check-update', async () => {
    try {
      const res = await net.fetch(UPDATE_MANIFEST_URL, { cache: 'no-store' })
      if (!res.ok) return null
      return await res.json()
    } catch (err) {
      console.error('[WZ PDF] check-update failed:', err instanceof Error ? err.message : String(err))
      return null
    }
  })

  ipcMain.handle('open-download', async (_event, rawUrl?: unknown) => {
    // Only ever open the trusted update host — never an arbitrary renderer-supplied URL.
    const target =
      typeof rawUrl === 'string' && rawUrl.startsWith(UPDATE_HOST_PREFIX)
        ? rawUrl
        : 'https://whyzoo.com/WzPDF/download.php'
    await shell.openExternal(target)
    return { success: true }
  })
}
