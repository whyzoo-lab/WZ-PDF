# Electron PDF Viewer — Design Spec

**Date:** 2026-05-22
**Status:** Approved

---

## Overview

Wrap the existing React + Vite PDF editor as an Electron desktop app. Add Viewer/Editor mode toggle (default: Viewer) and four view modes (Single, Spread, Grid, Fullscreen). Enable desktop file association so double-clicking a `.pdf` file opens it directly in the app.

HTML Export (PDF → standalone HTML) is out of scope for this spec — deferred to a future spec.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Existing | React + TypeScript + Vite + TailwindCSS v4 |
| Desktop shell | Electron |
| Process runner | concurrently |
| IPC | Electron ipcMain / ipcRenderer (preload) |

---

## Architecture

### Electron Integration Approach

Add Electron directly to the existing Vite project — minimal restructuring. A new `electron/` folder holds the main process and preload script. Development runs Vite dev server + Electron in parallel via `concurrently`.

```
npm run dev
  → vite (localhost:5173)
  → electron . (loads BrowserWindow → localhost:5173)
```

### New Types

```typescript
type AppMode = 'viewer' | 'editor'    // default: 'viewer'
type ViewMode = 'single' | 'spread' | 'grid' | 'fullscreen'  // default: 'single'
```

### Data Flow

```
Electron main.ts
  → detect file path (process.argv on Windows, open-file event on macOS)
  → ipcMain.emit('open-file', filePath)
  → preload.ts: window.electronAPI.onOpenFile(callback)
  → App.tsx: fetch(filePath) → File object → handleUpload()
  → PdfViewer receives viewMode prop
  → renders Single | Spread | Grid | Fullscreen layout
```

---

## File Structure Changes

```
electron/
  main.ts            # BrowserWindow creation, file association, IPC
  preload.ts         # Exposes window.electronAPI to renderer

src/
  App.tsx                          # appMode + viewMode state, Electron file listener
  components/
    toolbar/
      ActionBar.tsx                # Viewer/Editor toggle + view mode buttons
      Toolbar.tsx                  # Hides annotation tools in viewer mode
    viewer/
      PdfViewer.tsx                # viewMode prop, delegates to sub-components
      SpreadView.tsx               # New: two-page spread layout
      GridView.tsx                 # New: thumbnail grid layout
      FullscreenView.tsx           # New: single-page fullscreen layout

package.json                       # Electron dev/build scripts
vite.config.ts                     # Electron-compatible (no open, fixed port)
tsconfig.node.json                 # Include electron/ folder
```

---

## Viewer / Editor Mode

### Toggle Location

`ActionBar` top-right area, always visible:

```
┌──────────────────────────────────────────────────────────────┐
│ PDF Editor   [⊟][⊞][⋮⋮][⛶]          [Viewer|Editor] [Export] │
└──────────────────────────────────────────────────────────────┘
```

- Default on app start: `viewer`
- Mode persists across file changes (user preference, not per-file)
- Switching to `editor` mode switches `viewMode` to `single` if currently in `fullscreen`

### Toolbar Visibility

| Element | Viewer | Editor |
|---|---|---|
| Select | ✅ | ✅ |
| Stamp | ❌ | ✅ |
| Signature | ❌ | ✅ |
| Watermark | ❌ | ✅ |
| Delete | ❌ | ✅ |
| ZoomControls | ✅ | ✅ |

### ActionBar Visibility

| Element | Viewer | Editor |
|---|---|---|
| Upload PDF | ✅ | ✅ |
| View mode buttons | ✅ | ✅ |
| Viewer/Editor toggle | ✅ | ✅ |
| Export PDF | ❌ | ✅ |

---

## View Modes

### View Mode Controls

Four icon buttons in `ActionBar`, always visible when a PDF is loaded:

| Button | Mode | Icon |
|---|---|---|
| Single | `single` | ⊟ (single page) |
| Spread | `spread` | ⊞ (two pages) |
| Grid | `grid` | ⋮⋮ (grid) |
| Fullscreen | `fullscreen` | ⛶ |

Active mode button is highlighted.

### Single (default)

Current behavior unchanged — pages stacked vertically, continuous scroll.

### Spread

All pages displayed in two-column pairs, vertically scrollable:

```
┌──────────┐ ┌──────────┐
│  Page 1  │ │  Page 2  │
└──────────┘ └──────────┘
┌──────────┐ ┌──────────┐
│  Page 3  │ │  Page 4  │
└──────────┘ └──────────┘
```

- Each page is an independent Konva Stage (annotations work normally)
- If total pages is odd, last page is shown alone on the left
- Zoom controls apply to all pages uniformly

### Grid

Thumbnail overview — all pages in a 3-column CSS grid:

```
┌──────┐ ┌──────┐ ┌──────┐
│  1   │ │  2   │ │  3   │
└──────┘ └──────┘ └──────┘
┌──────┐ ┌──────┐
│  4   │ │  5   │
└──────┘ └──────┘
```

- Fixed zoom: `0.3` (thumbnails, not editable in this mode)
- Clicking a page thumbnail → switches to `single` mode and scrolls to that page
- Zoom controls hidden in grid mode

### Fullscreen

Single-page view, one page at a time, OS fullscreen:

- `document.documentElement.requestFullscreen()` on enter
- Page auto-scaled to fill screen height (zoom calculated from window dimensions)
- Navigation: `←` / `→` arrow keys, `PageUp` / `PageDown`
- `Escape` exits fullscreen and returns to `single` mode
- Bottom overlay: `Page 3 / 12` (fades out after 2 seconds, reappears on interaction)
- Switching to `editor` mode while in fullscreen → exits fullscreen, returns to `single`

---

## Electron: Main Process (`electron/main.ts`)

### Window Creation

```typescript
const win = new BrowserWindow({
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
```

### File Association

**Windows** — file path passed via `process.argv`:
```typescript
const filePath = process.argv.find(arg => arg.endsWith('.pdf'))
if (filePath) win.webContents.once('did-finish-load', () => {
  win.webContents.send('open-file', filePath)
})
```

**macOS** — `open-file` event fires before or after app ready:
```typescript
let pendingFile: string | null = null
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (win) win.webContents.send('open-file', filePath)
  else pendingFile = filePath
})
```

---

## Electron: Preload Script (`electron/preload.ts`)

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  onOpenFile: (callback: (filePath: string) => void) => {
    ipcRenderer.on('open-file', (_event, filePath) => callback(filePath))
  },
})
```

TypeScript declaration in `src/electron.d.ts`:
```typescript
interface Window {
  electronAPI?: {
    onOpenFile: (callback: (filePath: string) => void) => void
  }
}
```

---

## App.tsx Changes

```typescript
// Listen for Electron file open
useEffect(() => {
  window.electronAPI?.onOpenFile(async (filePath: string) => {
    const response = await fetch(`file://${filePath}`)
    const blob = await response.blob()
    const file = new File([blob], filePath.split(/[\\/]/).pop() ?? 'file.pdf', { type: 'application/pdf' })
    handleUpload(file)
  })
}, [handleUpload])

// New state
const [appMode, setAppMode] = useState<AppMode>('viewer')
const [viewMode, setViewMode] = useState<ViewMode>('single')
```

---

## package.json Scripts

```json
{
  "main": "electron/main.js",
  "scripts": {
    "dev": "concurrently \"vite\" \"wait-on http://localhost:5173 && electron .\"",
    "dev:vite": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

Dependencies to add:
- `electron` (devDependency)
- `concurrently` (devDependency)
- `wait-on` (devDependency)
- `@types/electron` is built into `electron` package

---

## vite.config.ts Changes

```typescript
server: {
  port: 5173,   // fixed port so Electron can always connect
  strictPort: true,
},
base: './',     // relative paths for Electron file:// protocol compatibility
```

---

## Constraints

- Fullscreen mode: annotation editing disabled (viewer behavior only — Transformer handles exist but mode switching to editor exits fullscreen)
- Grid mode: zoom controls hidden, fixed 0.3× zoom
- Spread mode: annotations render and are editable on each page independently
- `window.electronAPI` is optional — app still works in browser without Electron
- File association (.pdf → app) works in development via manual drag/drop; OS-level association requires packaged build (future)
