# Electron PDF Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing React + Vite PDF editor as an Electron desktop app, add a Viewer/Editor mode toggle, and four view modes (Single, Spread, Grid, Fullscreen).

**Architecture:** Add an `electron/` folder with `main.ts` + `preload.ts` alongside the existing `src/`. Electron loads the Vite dev server during development. App state gains `appMode` (viewer/editor) and `viewMode` (single/spread/grid/fullscreen); four new view components are delegated to from an updated `PdfViewer`.

**Tech Stack:** Electron, concurrently, wait-on (dev deps); existing React + TypeScript + Vite + TailwindCSS v4 stack unchanged.

---

## File Map

| Status | Path | Purpose |
|--------|------|---------|
| Create | `src/types/viewModes.ts` | `AppMode` and `ViewMode` type definitions |
| Create | `src/electron.d.ts` | `window.electronAPI` TypeScript declaration |
| Modify | `package.json` | Add Electron scripts + dependencies |
| Modify | `vite.config.ts` | Fixed port 5173, `strictPort`, `base: './'` |
| Create | `tsconfig.electron.json` | Compile `electron/` to CommonJS JS |
| Modify | `tsconfig.node.json` | Add `electron/**/*` for IDE type-checking |
| Modify | `.gitignore` | Ignore compiled `electron/*.js` outputs |
| Create | `electron/main.ts` | BrowserWindow, file association, IPC |
| Create | `electron/preload.ts` | `contextBridge` IPC bridge |
| Modify | `src/components/toolbar/ActionBar.tsx` | View mode buttons + Viewer/Editor toggle |
| Create | `src/components/toolbar/__tests__/ActionBar.test.tsx` | ActionBar tests |
| Modify | `src/components/toolbar/Toolbar.tsx` | Hide editor tools in viewer mode; hide zoom in grid mode |
| Create | `src/components/toolbar/__tests__/Toolbar.test.tsx` | Toolbar visibility tests |
| Create | `src/components/viewer/SpreadView.tsx` | Two-column page-pair layout |
| Create | `src/components/viewer/__tests__/SpreadView.test.tsx` | Spread layout tests |
| Create | `src/components/viewer/GridView.tsx` | 3-column thumbnail grid |
| Create | `src/components/viewer/__tests__/GridView.test.tsx` | Grid layout + click tests |
| Create | `src/components/viewer/FullscreenView.tsx` | OS fullscreen, one-page-at-a-time navigation |
| Create | `src/components/viewer/__tests__/FullscreenView.test.tsx` | Fullscreen tests |
| Modify | `src/components/viewer/PdfViewer.tsx` | Accept `viewMode` + delegate to sub-components |
| Create | `src/components/viewer/__tests__/PdfViewer.test.tsx` | ViewMode delegation tests |
| Modify | `src/App.tsx` | `appMode`/`viewMode` state, Electron listener, cross-mode rules |

---

## Task 1: AppMode / ViewMode types + window.electronAPI declaration

**Files:**
- Create: `src/types/viewModes.ts`
- Create: `src/electron.d.ts`

- [ ] **Step 1: Create `src/types/viewModes.ts`**

```typescript
export type AppMode = 'viewer' | 'editor'
export type ViewMode = 'single' | 'spread' | 'grid' | 'fullscreen'
```

- [ ] **Step 2: Create `src/electron.d.ts`**

```typescript
interface Window {
  electronAPI?: {
    onOpenFile: (callback: (filePath: string) => void) => void
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/viewModes.ts src/electron.d.ts
git commit -m "feat: add AppMode, ViewMode types and window.electronAPI declaration"
```

---

## Task 2: Electron project config

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `tsconfig.electron.json`
- Modify: `tsconfig.node.json`
- Modify: `.gitignore`

- [ ] **Step 1: Update `package.json`**

Replace the entire `scripts` block and add the `main` field plus three new dev dependencies. The final `package.json` becomes:

```json
{
  "name": "pdf-editor",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "electron/main.js",
  "scripts": {
    "predev": "tsc -p tsconfig.electron.json",
    "dev": "concurrently \"vite\" \"wait-on http://localhost:5173 && electron .\"",
    "dev:vite": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:run": "vitest run",
    "electron:compile": "tsc -p tsconfig.electron.json"
  },
  "dependencies": {
    "konva": "^10.3.0",
    "pdf-lib": "^1.17.1",
    "pdfjs-dist": "^5.7.284",
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "react-konva": "^19.2.4"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@tailwindcss/vite": "^4.3.0",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/node": "^24.12.3",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.2",
    "concurrently": "^9.1.0",
    "electron": "^36.0.0",
    "eslint": "^10.3.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.2",
    "globals": "^17.6.0",
    "jsdom": "^29.1.1",
    "tailwindcss": "^4.3.0",
    "typescript": "~6.0.2",
    "typescript-eslint": "^8.59.2",
    "vite": "^8.0.12",
    "vitest": "^4.1.7",
    "wait-on": "^8.0.1"
  }
}
```

- [ ] **Step 2: Install new dependencies**

Run: `npm install`
Expected: `node_modules/electron/` and `node_modules/concurrently/` and `node_modules/wait-on/` are present. No errors.

- [ ] **Step 3: Update `vite.config.ts`**

```typescript
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
  },
  base: './',
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
```

- [ ] **Step 4: Create `tsconfig.electron.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": ".",
    "rootDir": ".",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["electron/**/*"]
}
```

- [ ] **Step 5: Update `tsconfig.node.json`** (IDE type-check only — `noEmit` stays true)

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "module": "esnext",
    "types": ["node"],
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,

    /* Linting */
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["vite.config.ts", "electron/**/*"]
}
```

- [ ] **Step 6: Update `.gitignore`** — ignore compiled Electron outputs

Add these two lines to `.gitignore`:

```
# Electron compiled outputs
electron/*.js
electron/*.js.map
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.config.ts tsconfig.electron.json tsconfig.node.json .gitignore
git commit -m "chore: add Electron project config (package.json, vite.config, tsconfigs)"
```

---

## Task 3: Electron preload + main process

**Files:**
- Create: `electron/preload.ts`
- Create: `electron/main.ts`

- [ ] **Step 1: Create `electron/preload.ts`**

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  onOpenFile: (callback: (filePath: string) => void) => {
    ipcRenderer.on('open-file', (_event, filePath: string) => callback(filePath))
  },
})
```

- [ ] **Step 2: Create `electron/main.ts`**

```typescript
import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'

let win: BrowserWindow | null = null
let pendingFile: string | null = null

function createWindow() {
  win = new BrowserWindow({
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

  win.on('closed', () => { win = null })
}

app.whenReady().then(() => {
  createWindow()

  // Windows: file path via process.argv
  const argFile = process.argv.find(arg => arg.endsWith('.pdf'))
  if (argFile && win) {
    win.webContents.once('did-finish-load', () => {
      win?.webContents.send('open-file', argFile)
    })
  }

  // Send pending file from open-file event (macOS)
  if (pendingFile && win) {
    const filePath = pendingFile
    pendingFile = null
    win.webContents.once('did-finish-load', () => {
      win?.webContents.send('open-file', filePath)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// macOS: file association fires before or after app ready
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (win) {
    win.webContents.send('open-file', filePath)
  } else {
    pendingFile = filePath
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Suppress unused import warning — ipcMain reserved for future use
void ipcMain
```

- [ ] **Step 3: Compile and verify**

Run: `npm run electron:compile`
Expected: `electron/main.js` and `electron/preload.js` are created. No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat: add Electron main process and preload bridge"
```

---

## Task 4: ActionBar — view mode buttons + Viewer/Editor toggle

**Files:**
- Modify: `src/components/toolbar/ActionBar.tsx`
- Create: `src/components/toolbar/__tests__/ActionBar.test.tsx`

The existing props (`hasPdf`, `onUpload`, `onExport`, `isExporting`) are all kept. Four new props are added: `appMode`, `viewMode`, `onAppModeChange`, `onViewModeChange`. The Export button moves to editor-mode-only visibility.

- [ ] **Step 1: Write the failing test**

Create `src/components/toolbar/__tests__/ActionBar.test.tsx`:

```typescript
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionBar } from '../ActionBar'
import type { AppMode, ViewMode } from '../../../types/viewModes'

const defaultProps = {
  hasPdf: true,
  appMode: 'viewer' as AppMode,
  viewMode: 'single' as ViewMode,
  onUpload: vi.fn(),
  onExport: vi.fn(),
  isExporting: false,
  onAppModeChange: vi.fn(),
  onViewModeChange: vi.fn(),
}

describe('ActionBar', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows view mode buttons when hasPdf is true', () => {
    render(<ActionBar {...defaultProps} />)
    expect(screen.getByRole('button', { name: /single page/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /spread/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /grid/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fullscreen/i })).toBeInTheDocument()
  })

  it('hides view mode buttons when hasPdf is false', () => {
    render(<ActionBar {...defaultProps} hasPdf={false} />)
    expect(screen.queryByRole('button', { name: /single page/i })).not.toBeInTheDocument()
  })

  it('highlights the active view mode button', () => {
    render(<ActionBar {...defaultProps} viewMode="spread" />)
    const spreadBtn = screen.getByRole('button', { name: /spread/i })
    expect(spreadBtn.className).toContain('bg-blue-600')
  })

  it('does not highlight inactive view mode buttons', () => {
    render(<ActionBar {...defaultProps} viewMode="spread" />)
    const singleBtn = screen.getByRole('button', { name: /single page/i })
    expect(singleBtn.className).not.toContain('bg-blue-600')
  })

  it('hides Export PDF button in viewer mode', () => {
    render(<ActionBar {...defaultProps} appMode="viewer" hasPdf={true} />)
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument()
  })

  it('shows Export PDF button in editor mode', () => {
    render(<ActionBar {...defaultProps} appMode="editor" hasPdf={true} />)
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
  })

  it('calls onViewModeChange with correct mode when view button clicked', () => {
    render(<ActionBar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /spread/i }))
    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith('spread')
  })

  it('calls onAppModeChange("editor") when Editor button clicked', () => {
    render(<ActionBar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /^editor$/i }))
    expect(defaultProps.onAppModeChange).toHaveBeenCalledWith('editor')
  })

  it('calls onAppModeChange("viewer") when Viewer button clicked', () => {
    render(<ActionBar {...defaultProps} appMode="editor" />)
    fireEvent.click(screen.getByRole('button', { name: /^viewer$/i }))
    expect(defaultProps.onAppModeChange).toHaveBeenCalledWith('viewer')
  })

  it('shows Upload PDF button always', () => {
    render(<ActionBar {...defaultProps} hasPdf={false} />)
    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/toolbar/__tests__/ActionBar.test.tsx`
Expected: FAIL (ActionBar has wrong props interface)

- [ ] **Step 3: Rewrite `src/components/toolbar/ActionBar.tsx`**

```typescript
import React, { useRef } from 'react'
import type { AppMode, ViewMode } from '../../types/viewModes'

interface ActionBarProps {
  hasPdf: boolean
  appMode: AppMode
  viewMode: ViewMode
  onUpload: (file: File) => void
  onExport: () => void
  isExporting: boolean
  onAppModeChange: (mode: AppMode) => void
  onViewModeChange: (mode: ViewMode) => void
}

export function ActionBar({
  hasPdf,
  appMode,
  viewMode,
  onUpload,
  onExport,
  isExporting,
  onAppModeChange,
  onViewModeChange,
}: ActionBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onUpload(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.type === 'application/pdf') onUpload(file)
  }

  const viewBtn = (mode: ViewMode) =>
    `px-2 py-1 text-sm rounded transition-colors ${
      viewMode === mode
        ? 'bg-blue-600 text-white'
        : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
    }`

  const modeBtn = (mode: AppMode) =>
    `px-3 py-1 text-sm transition-colors ${
      appMode === mode
        ? 'bg-blue-600 text-white'
        : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
    }`

  return (
    <header
      className="flex items-center justify-between px-4 py-2 bg-gray-900 text-white shadow-md z-10 shrink-0"
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
    >
      <span className="font-semibold text-sm tracking-wide">PDF Editor</span>

      <div className="flex gap-2 items-center">
        {/* View mode buttons — only when a PDF is loaded */}
        {hasPdf && (
          <div className="flex gap-1">
            <button
              className={viewBtn('single')}
              onClick={() => onViewModeChange('single')}
              aria-label="Single page view"
              title="Single page"
            >
              ⊟
            </button>
            <button
              className={viewBtn('spread')}
              onClick={() => onViewModeChange('spread')}
              aria-label="Spread view"
              title="Spread"
            >
              ⊞
            </button>
            <button
              className={viewBtn('grid')}
              onClick={() => onViewModeChange('grid')}
              aria-label="Grid view"
              title="Grid"
            >
              ▦
            </button>
            <button
              className={viewBtn('fullscreen')}
              onClick={() => onViewModeChange('fullscreen')}
              aria-label="Fullscreen view"
              title="Fullscreen"
            >
              ⛶
            </button>
          </div>
        )}

        {/* Viewer / Editor toggle */}
        <div className="flex border border-gray-600 rounded overflow-hidden">
          <button
            className={modeBtn('viewer')}
            onClick={() => onAppModeChange('viewer')}
            aria-label="Viewer"
          >
            Viewer
          </button>
          <button
            className={modeBtn('editor')}
            onClick={() => onAppModeChange('editor')}
            aria-label="Editor"
          >
            Editor
          </button>
        </div>

        {/* Upload */}
        <button
          onClick={() => inputRef.current?.click()}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded transition-colors"
          aria-label="Upload PDF"
        >
          <span className="hidden sm:inline">Upload PDF</span>
          <span className="sm:hidden">Upload</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Export — only in editor mode */}
        {hasPdf && appMode === 'editor' && (
          <button
            onClick={onExport}
            disabled={isExporting}
            className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-500 rounded transition-colors disabled:opacity-50"
          >
            {isExporting ? 'Exporting…' : 'Export PDF'}
          </button>
        )}
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/toolbar/__tests__/ActionBar.test.tsx`
Expected: all 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/toolbar/ActionBar.tsx src/components/toolbar/__tests__/ActionBar.test.tsx
git commit -m "feat: add view mode buttons and Viewer/Editor toggle to ActionBar"
```

---

## Task 5: Toolbar — hide editor tools in viewer mode; hide zoom in grid mode

**Files:**
- Modify: `src/components/toolbar/Toolbar.tsx`
- Create: `src/components/toolbar/__tests__/Toolbar.test.tsx`

The existing Toolbar props are kept unchanged. Two new props are added: `appMode` and `viewMode`.

- [ ] **Step 1: Write the failing test**

Create `src/components/toolbar/__tests__/Toolbar.test.tsx`:

```typescript
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Toolbar } from '../Toolbar'
import type { AppMode, ViewMode } from '../../../types/viewModes'

const defaultProps = {
  activeMode: null as const,
  selectedId: null as null | string,
  zoom: 1,
  hasPdf: true,
  appMode: 'editor' as AppMode,
  viewMode: 'single' as ViewMode,
  onModeChange: vi.fn(),
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onZoomReset: vi.fn(),
  onDeleteSelected: vi.fn(),
  onStampSelect: vi.fn(),
  onSignatureClick: vi.fn(),
  onWatermarkClick: vi.fn(),
}

describe('Toolbar', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows Stamp button in editor mode', () => {
    render(<Toolbar {...defaultProps} appMode="editor" />)
    expect(screen.getByRole('button', { name: /stamp/i })).toBeInTheDocument()
  })

  it('hides Stamp button in viewer mode', () => {
    render(<Toolbar {...defaultProps} appMode="viewer" />)
    expect(screen.queryByRole('button', { name: /stamp/i })).not.toBeInTheDocument()
  })

  it('hides Signature button in viewer mode', () => {
    render(<Toolbar {...defaultProps} appMode="viewer" />)
    expect(screen.queryByRole('button', { name: /signature/i })).not.toBeInTheDocument()
  })

  it('hides Watermark button in viewer mode', () => {
    render(<Toolbar {...defaultProps} appMode="viewer" />)
    expect(screen.queryByRole('button', { name: /watermark/i })).not.toBeInTheDocument()
  })

  it('shows Select button in viewer mode', () => {
    render(<Toolbar {...defaultProps} appMode="viewer" />)
    expect(screen.getByRole('button', { name: /select/i })).toBeInTheDocument()
  })

  it('hides Delete button in viewer mode even when selectedId is set', () => {
    render(<Toolbar {...defaultProps} appMode="viewer" selectedId="ann-1" />)
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('shows ZoomControls in single mode', () => {
    render(<Toolbar {...defaultProps} viewMode="single" />)
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument()
  })

  it('hides ZoomControls in grid mode', () => {
    render(<Toolbar {...defaultProps} viewMode="grid" />)
    expect(screen.queryByRole('button', { name: /zoom in/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/toolbar/__tests__/Toolbar.test.tsx`
Expected: FAIL (Toolbar lacks appMode / viewMode props)

- [ ] **Step 3: Update `src/components/toolbar/Toolbar.tsx`**

```typescript
import React, { useState } from 'react'
import type { ActiveMode } from '../../types/annotation'
import type { AppMode, ViewMode } from '../../types/viewModes'
import { STAMP_PRESETS, svgToPng } from '../../utils/stampPresets'
import { ZoomControls } from '../viewer/ZoomControls'

interface ToolbarProps {
  activeMode: ActiveMode
  selectedId: string | null
  zoom: number
  hasPdf: boolean
  appMode: AppMode
  viewMode: ViewMode
  onModeChange: (mode: ActiveMode) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onDeleteSelected: () => void
  onStampSelect: (src: string, presetId?: string) => void
  onSignatureClick: () => void
  onWatermarkClick: () => void
}

export function Toolbar({
  activeMode,
  selectedId,
  zoom,
  hasPdf,
  appMode,
  viewMode,
  onModeChange,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onDeleteSelected,
  onStampSelect,
  onSignatureClick,
  onWatermarkClick,
}: ToolbarProps) {
  const [stampPanelOpen, setStampPanelOpen] = useState(false)

  const handlePresetClick = async (presetId: string, svg: string) => {
    try {
      const pngDataUrl = await svgToPng(svg)
      onStampSelect(pngDataUrl, presetId)
      setStampPanelOpen(false)
      onModeChange('stamp')
    } catch (err) {
      console.error('Failed to convert stamp SVG:', err)
    }
  }

  const handleCustomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const result = ev.target?.result
      if (typeof result !== 'string') return
      onStampSelect(result)
      setStampPanelOpen(false)
      onModeChange('stamp')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const btn = (mode: ActiveMode) =>
    `w-full py-2 px-2 text-xs sm:text-sm rounded text-left transition-colors ${
      activeMode === mode
        ? 'bg-blue-600 text-white'
        : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
    }`

  return (
    <aside className="flex flex-col w-12 sm:w-36 bg-gray-800 text-white py-3 px-1 sm:px-2 gap-1 shrink-0">
      {hasPdf && (
        <>
          <button
            className={btn('select')}
            onClick={() => { onModeChange('select'); setStampPanelOpen(false) }}
            aria-label="Select"
          >
            <span className="sm:hidden">↖</span>
            <span className="hidden sm:inline">Select</span>
          </button>

          {appMode === 'editor' && (
            <>
              <button
                className={btn('stamp')}
                onClick={() => setStampPanelOpen(v => !v)}
                aria-label="Stamp"
              >
                <span className="sm:hidden">🔖</span>
                <span className="hidden sm:inline">Stamp</span>
              </button>

              {stampPanelOpen && (
                <div className="bg-gray-700 rounded p-1 flex flex-col gap-0.5">
                  {STAMP_PRESETS.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handlePresetClick(p.id, p.svg)}
                      className="text-xs text-left px-2 py-1.5 hover:bg-gray-600 rounded"
                    >
                      {p.label}
                    </button>
                  ))}
                  <label className="text-xs text-left px-2 py-1.5 hover:bg-gray-600 rounded cursor-pointer">
                    Upload PNG…
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={handleCustomUpload}
                    />
                  </label>
                </div>
              )}

              <button
                className={btn('signature')}
                onClick={() => { onModeChange('signature'); onSignatureClick(); setStampPanelOpen(false) }}
                aria-label="Signature"
              >
                <span className="sm:hidden">✍</span>
                <span className="hidden sm:inline">Signature</span>
              </button>

              <button
                className={btn('watermark')}
                onClick={() => { onModeChange('watermark'); onWatermarkClick(); setStampPanelOpen(false) }}
                aria-label="Watermark"
              >
                <span className="sm:hidden">💧</span>
                <span className="hidden sm:inline">Watermark</span>
              </button>

              {selectedId && (
                <button
                  onClick={onDeleteSelected}
                  className="w-full py-2 px-2 text-xs sm:text-sm rounded text-left bg-red-700 hover:bg-red-600 text-white mt-2 transition-colors"
                  aria-label="Delete"
                >
                  <span className="sm:hidden">🗑</span>
                  <span className="hidden sm:inline">Delete</span>
                </button>
              )}
            </>
          )}
        </>
      )}

      {viewMode !== 'grid' && (
        <ZoomControls zoom={zoom} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onZoomReset={onZoomReset} />
      )}
    </aside>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/toolbar/__tests__/Toolbar.test.tsx`
Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/toolbar/Toolbar.tsx src/components/toolbar/__tests__/Toolbar.test.tsx
git commit -m "feat: hide editor tools in viewer mode; hide zoom in grid mode"
```

---

## Task 6: SpreadView component

**Files:**
- Create: `src/components/viewer/SpreadView.tsx`
- Create: `src/components/viewer/__tests__/SpreadView.test.tsx`

All pages are displayed in two-column pairs. Each pair is a row. If numPages is odd, the last page sits alone on the left. Each page is a full `PdfPage` (annotations fully editable).

- [ ] **Step 1: Write the failing test**

Create `src/components/viewer/__tests__/SpreadView.test.tsx`:

```typescript
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SpreadView } from '../SpreadView'
import type { PDFDocumentProxy } from 'pdfjs-dist'

vi.mock('../PdfPage', () => ({
  PdfPage: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`page-${pageNumber}`} />
  ),
}))

const mockDoc = {} as PDFDocumentProxy
const baseProps = {
  pdfDoc: mockDoc,
  zoom: 1,
  annotations: [],
  selectedId: null,
  activeMode: null as const,
  pendingStamp: null,
  pendingSignature: null,
  onAnnotationSelect: vi.fn(),
  onAnnotationUpdate: vi.fn(),
  onAnnotationAdd: vi.fn(),
}

describe('SpreadView', () => {
  it('renders all pages for even numPages', () => {
    render(<SpreadView {...baseProps} numPages={4} />)
    for (let i = 1; i <= 4; i++) {
      expect(screen.getByTestId(`page-${i}`)).toBeInTheDocument()
    }
  })

  it('renders all pages for odd numPages', () => {
    render(<SpreadView {...baseProps} numPages={5} />)
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByTestId(`page-${i}`)).toBeInTheDocument()
    }
  })

  it('renders correct number of page pairs (rows) for even numPages', () => {
    const { container } = render(<SpreadView {...baseProps} numPages={4} />)
    // 4 pages → 2 rows
    const rows = container.querySelectorAll('[data-spread-row]')
    expect(rows).toHaveLength(2)
  })

  it('renders correct number of rows for odd numPages', () => {
    const { container } = render(<SpreadView {...baseProps} numPages={5} />)
    // 5 pages → 3 rows (last row has only page 5)
    const rows = container.querySelectorAll('[data-spread-row]')
    expect(rows).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/viewer/__tests__/SpreadView.test.tsx`
Expected: FAIL (SpreadView does not exist)

- [ ] **Step 3: Create `src/components/viewer/SpreadView.tsx`**

```typescript
import React from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPage } from './PdfPage'
import type { Annotation, ActiveMode } from '../../types/annotation'

interface SpreadViewProps {
  pdfDoc: PDFDocumentProxy
  numPages: number
  zoom: number
  annotations: Annotation[]
  selectedId: string | null
  activeMode: ActiveMode
  pendingStamp: { src: string; presetId?: string } | null
  pendingSignature: string | null
  onAnnotationSelect: (id: string | null) => void
  onAnnotationUpdate: (id: string, updates: Partial<Annotation>) => void
  onAnnotationAdd: (annotation: Omit<Annotation, 'id'>) => void
}

export function SpreadView({
  pdfDoc,
  numPages,
  zoom,
  annotations,
  selectedId,
  activeMode,
  pendingStamp,
  pendingSignature,
  onAnnotationSelect,
  onAnnotationUpdate,
  onAnnotationAdd,
}: SpreadViewProps) {
  // Build pairs: [[1,2], [3,4], [5]] for numPages=5
  const pairs: number[][] = []
  for (let i = 1; i <= numPages; i += 2) {
    pairs.push(i + 1 <= numPages ? [i, i + 1] : [i])
  }

  const pageProps = {
    pdfDoc,
    zoom,
    annotations,
    selectedId,
    activeMode,
    pendingStamp,
    pendingSignature,
    onAnnotationSelect,
    onAnnotationUpdate,
    onAnnotationAdd,
  }

  return (
    <div className="flex flex-col items-center gap-4 py-6 px-4 overflow-auto h-full bg-gray-300">
      {pairs.map((pair, idx) => (
        <div key={idx} data-spread-row className="flex gap-4">
          {pair.map(pageNum => (
            <div key={pageNum} className="shadow-xl">
              <PdfPage {...pageProps} pageNumber={pageNum} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/viewer/__tests__/SpreadView.test.tsx`
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/viewer/SpreadView.tsx src/components/viewer/__tests__/SpreadView.test.tsx
git commit -m "feat: add SpreadView component (two-column page pairs)"
```

---

## Task 7: GridView component

**Files:**
- Create: `src/components/viewer/GridView.tsx`
- Create: `src/components/viewer/__tests__/GridView.test.tsx`

All pages rendered as thumbnail stills (fixed zoom 0.3). Clicking a page thumbnail calls `onPageClick(pageNumber)`. No annotation editing in grid mode (thumbnails are read-only).

- [ ] **Step 1: Write the failing test**

Create `src/components/viewer/__tests__/GridView.test.tsx`:

```typescript
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GridView } from '../GridView'
import type { PDFDocumentProxy } from 'pdfjs-dist'

vi.mock('../PdfPage', () => ({
  PdfPage: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`page-${pageNumber}`} />
  ),
}))

const mockDoc = {} as PDFDocumentProxy

describe('GridView', () => {
  it('renders all page thumbnails', () => {
    render(<GridView pdfDoc={mockDoc} numPages={5} annotations={[]} onPageClick={vi.fn()} />)
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByTestId(`page-${i}`)).toBeInTheDocument()
    }
  })

  it('calls onPageClick with the correct page number when a thumbnail is clicked', () => {
    const onPageClick = vi.fn()
    render(<GridView pdfDoc={mockDoc} numPages={3} annotations={[]} onPageClick={onPageClick} />)
    fireEvent.click(screen.getByTestId('page-2'))
    expect(onPageClick).toHaveBeenCalledWith(2)
  })

  it('calls onPageClick with page 1 when first thumbnail is clicked', () => {
    const onPageClick = vi.fn()
    render(<GridView pdfDoc={mockDoc} numPages={3} annotations={[]} onPageClick={onPageClick} />)
    fireEvent.click(screen.getByTestId('page-1'))
    expect(onPageClick).toHaveBeenCalledWith(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/viewer/__tests__/GridView.test.tsx`
Expected: FAIL (GridView does not exist)

- [ ] **Step 3: Create `src/components/viewer/GridView.tsx`**

```typescript
import React from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPage } from './PdfPage'
import type { Annotation } from '../../types/annotation'

const GRID_ZOOM = 0.3

interface GridViewProps {
  pdfDoc: PDFDocumentProxy
  numPages: number
  annotations: Annotation[]
  onPageClick: (pageNumber: number) => void
}

export function GridView({ pdfDoc, numPages, annotations, onPageClick }: GridViewProps) {
  return (
    <div className="grid grid-cols-3 gap-4 p-6 overflow-auto h-full bg-gray-300">
      {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
        <button
          key={pageNum}
          className="flex flex-col items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity bg-transparent border-0 p-0"
          onClick={() => onPageClick(pageNum)}
          aria-label={`Go to page ${pageNum}`}
        >
          <div className="shadow-md">
            <PdfPage
              pdfDoc={pdfDoc}
              pageNumber={pageNum}
              zoom={GRID_ZOOM}
              annotations={annotations}
              selectedId={null}
              activeMode={null}
              pendingStamp={null}
              pendingSignature={null}
              onAnnotationSelect={() => {}}
              onAnnotationUpdate={() => {}}
              onAnnotationAdd={() => {}}
            />
          </div>
          <span className="text-xs text-gray-600">{pageNum}</span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/viewer/__tests__/GridView.test.tsx`
Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/viewer/GridView.tsx src/components/viewer/__tests__/GridView.test.tsx
git commit -m "feat: add GridView component (3-column thumbnail grid)"
```

---

## Task 8: FullscreenView component

**Files:**
- Create: `src/components/viewer/FullscreenView.tsx`
- Create: `src/components/viewer/__tests__/FullscreenView.test.tsx`

One page at a time, OS fullscreen, auto-scaled to fill screen height. Arrow key / PageUp / PageDown navigation. Escape exits and triggers `onExit()`. "Page N / M" overlay fades after 2 seconds.

- [ ] **Step 1: Write the failing test**

Create `src/components/viewer/__tests__/FullscreenView.test.tsx`:

```typescript
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { FullscreenView } from '../FullscreenView'
import type { PDFDocumentProxy } from 'pdfjs-dist'

vi.mock('../PdfPage', () => ({
  PdfPage: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`page-${pageNumber}`} />
  ),
}))

const mockRequestFullscreen = vi.fn().mockResolvedValue(undefined)
const mockExitFullscreen = vi.fn().mockResolvedValue(undefined)

const mockDoc = {
  getPage: vi.fn().mockResolvedValue({
    getViewport: vi.fn().mockReturnValue({ width: 600, height: 800 }),
  }),
} as unknown as PDFDocumentProxy

const baseProps = {
  pdfDoc: mockDoc,
  numPages: 5,
  annotations: [],
  selectedId: null as null | string,
  onAnnotationSelect: vi.fn(),
  onAnnotationUpdate: vi.fn(),
  onExit: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()

  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    value: mockRequestFullscreen,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(document, 'exitFullscreen', {
    value: mockExitFullscreen,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(document, 'fullscreenElement', {
    value: null,
    writable: true,
    configurable: true,
  })
})

describe('FullscreenView', () => {
  it('requests fullscreen on mount', () => {
    render(<FullscreenView {...baseProps} />)
    expect(mockRequestFullscreen).toHaveBeenCalled()
  })

  it('shows page 1 on initial render', () => {
    render(<FullscreenView {...baseProps} />)
    expect(screen.getByTestId('page-1')).toBeInTheDocument()
  })

  it('shows page overlay with "1 / 5"', () => {
    render(<FullscreenView {...baseProps} />)
    expect(screen.getByText(/1\s*\/\s*5/)).toBeInTheDocument()
  })

  it('navigates to page 2 on ArrowRight', () => {
    render(<FullscreenView {...baseProps} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByTestId('page-2')).toBeInTheDocument()
  })

  it('navigates to page 2 on PageDown', () => {
    render(<FullscreenView {...baseProps} />)
    fireEvent.keyDown(window, { key: 'PageDown' })
    expect(screen.getByTestId('page-2')).toBeInTheDocument()
  })

  it('does not navigate before page 1 on ArrowLeft', () => {
    render(<FullscreenView {...baseProps} />)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByTestId('page-1')).toBeInTheDocument()
  })

  it('does not navigate past last page on ArrowRight', () => {
    render(<FullscreenView {...baseProps} numPages={1} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByTestId('page-1')).toBeInTheDocument()
  })

  it('calls onExit when fullscreenchange fires with no fullscreenElement', () => {
    const onExit = vi.fn()
    render(<FullscreenView {...baseProps} onExit={onExit} />)
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(onExit).toHaveBeenCalled()
  })

  it('does not call onExit on unmount-triggered fullscreenchange', () => {
    const onExit = vi.fn()
    const { unmount } = render(<FullscreenView {...baseProps} onExit={onExit} />)
    unmount()
    // fullscreenchange may fire after unmount; onExit should NOT be called again
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(onExit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/viewer/__tests__/FullscreenView.test.tsx`
Expected: FAIL (FullscreenView does not exist)

- [ ] **Step 3: Create `src/components/viewer/FullscreenView.tsx`**

```typescript
import React, { useState, useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPage } from './PdfPage'
import type { Annotation } from '../../types/annotation'
import { PDF_RENDER_SCALE } from '../../utils/constants'

interface FullscreenViewProps {
  pdfDoc: PDFDocumentProxy
  numPages: number
  annotations: Annotation[]
  selectedId: string | null
  onAnnotationSelect: (id: string | null) => void
  onAnnotationUpdate: (id: string, updates: Partial<Annotation>) => void
  onExit: () => void
}

export function FullscreenView({
  pdfDoc,
  numPages,
  annotations,
  selectedId,
  onAnnotationSelect,
  onAnnotationUpdate,
  onExit,
}: FullscreenViewProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const [showOverlay, setShowOverlay] = useState(true)
  const [zoom, setZoom] = useState(1)
  const overlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exitingRef = useRef(false)

  // Calculate zoom from page dimensions to fill screen height
  useEffect(() => {
    let cancelled = false
    pdfDoc.getPage(currentPage).then(page => {
      if (cancelled) return
      const vp = page.getViewport({ scale: PDF_RENDER_SCALE })
      const newZoom = Math.min(
        window.innerHeight / vp.height,
        window.innerWidth / vp.width,
      )
      setZoom(newZoom)
    }).catch(console.error)
    return () => { cancelled = true }
  }, [pdfDoc, currentPage])

  // Recalculate zoom on resize
  useEffect(() => {
    const onResize = () => {
      pdfDoc.getPage(currentPage).then(page => {
        const vp = page.getViewport({ scale: PDF_RENDER_SCALE })
        setZoom(Math.min(
          window.innerHeight / vp.height,
          window.innerWidth / vp.width,
        ))
      }).catch(console.error)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [pdfDoc, currentPage])

  // Request OS fullscreen on mount; exit on unmount
  useEffect(() => {
    document.documentElement.requestFullscreen().catch(console.error)
    return () => {
      exitingRef.current = true
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(console.error)
      }
    }
  }, [])

  // Detect user-initiated fullscreen exit (Escape key triggers this via browser)
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && !exitingRef.current) {
        onExit()
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [onExit])

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        setCurrentPage(p => Math.min(p + 1, numPages))
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        setCurrentPage(p => Math.max(p - 1, 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [numPages])

  // Page overlay: show briefly on page change, fade after 2s
  const resetOverlay = () => {
    setShowOverlay(true)
    if (overlayTimer.current) clearTimeout(overlayTimer.current)
    overlayTimer.current = setTimeout(() => setShowOverlay(false), 2000)
  }

  useEffect(() => {
    resetOverlay()
    return () => { if (overlayTimer.current) clearTimeout(overlayTimer.current) }
  }, [currentPage])

  return (
    <div
      className="fixed inset-0 bg-black flex items-center justify-center z-50"
      onClick={resetOverlay}
    >
      <PdfPage
        pdfDoc={pdfDoc}
        pageNumber={currentPage}
        zoom={zoom}
        annotations={annotations}
        selectedId={selectedId}
        activeMode="select"
        pendingStamp={null}
        pendingSignature={null}
        onAnnotationSelect={onAnnotationSelect}
        onAnnotationUpdate={onAnnotationUpdate}
        onAnnotationAdd={() => {}}
      />

      {/* Page N / M overlay */}
      <div
        className={`fixed bottom-8 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded text-sm pointer-events-none transition-opacity duration-500 ${
          showOverlay ? 'opacity-100' : 'opacity-0'
        }`}
      >
        Page {currentPage} / {numPages}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/viewer/__tests__/FullscreenView.test.tsx`
Expected: all 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/viewer/FullscreenView.tsx src/components/viewer/__tests__/FullscreenView.test.tsx
git commit -m "feat: add FullscreenView component (OS fullscreen, arrow key navigation)"
```

---

## Task 9: PdfViewer — viewMode delegation

**Files:**
- Modify: `src/components/viewer/PdfViewer.tsx`
- Create: `src/components/viewer/__tests__/PdfViewer.test.tsx`

`PdfViewer` gains `viewMode`, `onGridPageClick`, and `onFullscreenExit` props. It delegates rendering to the correct sub-component. In single mode, page `div` wrappers get `id="pdf-page-N"` for scroll-to-page targeting.

- [ ] **Step 1: Write the failing test**

Create `src/components/viewer/__tests__/PdfViewer.test.tsx`:

```typescript
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PdfViewer } from '../PdfViewer'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ViewMode } from '../../../types/viewModes'

vi.mock('../PdfPage', () => ({
  PdfPage: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`page-${pageNumber}`} />
  ),
}))
vi.mock('../SpreadView', () => ({
  SpreadView: () => <div data-testid="spread-view" />,
}))
vi.mock('../GridView', () => ({
  GridView: () => <div data-testid="grid-view" />,
}))
vi.mock('../FullscreenView', () => ({
  FullscreenView: () => <div data-testid="fullscreen-view" />,
}))

const mockDoc = {} as PDFDocumentProxy
const baseProps = {
  pdfDoc: mockDoc,
  numPages: 3,
  zoom: 1,
  annotations: [],
  selectedId: null,
  activeMode: null as const,
  pendingStamp: null,
  pendingSignature: null,
  onAnnotationSelect: vi.fn(),
  onAnnotationUpdate: vi.fn(),
  onAnnotationAdd: vi.fn(),
  onGridPageClick: vi.fn(),
  onFullscreenExit: vi.fn(),
}

describe('PdfViewer', () => {
  it('renders PdfPage components in single mode', () => {
    render(<PdfViewer {...baseProps} viewMode="single" />)
    expect(screen.getByTestId('page-1')).toBeInTheDocument()
    expect(screen.queryByTestId('spread-view')).not.toBeInTheDocument()
  })

  it('assigns id="pdf-page-N" to single mode page wrappers', () => {
    const { container } = render(<PdfViewer {...baseProps} viewMode="single" />)
    expect(container.querySelector('#pdf-page-1')).not.toBeNull()
    expect(container.querySelector('#pdf-page-2')).not.toBeNull()
  })

  it('renders SpreadView in spread mode', () => {
    render(<PdfViewer {...baseProps} viewMode="spread" />)
    expect(screen.getByTestId('spread-view')).toBeInTheDocument()
    expect(screen.queryByTestId('page-1')).not.toBeInTheDocument()
  })

  it('renders GridView in grid mode', () => {
    render(<PdfViewer {...baseProps} viewMode="grid" />)
    expect(screen.getByTestId('grid-view')).toBeInTheDocument()
  })

  it('renders FullscreenView in fullscreen mode', () => {
    render(<PdfViewer {...baseProps} viewMode="fullscreen" />)
    expect(screen.getByTestId('fullscreen-view')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/viewer/__tests__/PdfViewer.test.tsx`
Expected: FAIL (PdfViewer lacks viewMode prop)

- [ ] **Step 3: Rewrite `src/components/viewer/PdfViewer.tsx`**

```typescript
import React from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPage } from './PdfPage'
import { SpreadView } from './SpreadView'
import { GridView } from './GridView'
import { FullscreenView } from './FullscreenView'
import type { Annotation, ActiveMode } from '../../types/annotation'
import type { ViewMode } from '../../types/viewModes'

interface PdfViewerProps {
  pdfDoc: PDFDocumentProxy
  numPages: number
  zoom: number
  annotations: Annotation[]
  selectedId: string | null
  activeMode: ActiveMode
  viewMode: ViewMode
  pendingStamp: { src: string; presetId?: string } | null
  pendingSignature: string | null
  onAnnotationSelect: (id: string | null) => void
  onAnnotationUpdate: (id: string, updates: Partial<Annotation>) => void
  onAnnotationAdd: (annotation: Omit<Annotation, 'id'>) => void
  onGridPageClick: (pageNumber: number) => void
  onFullscreenExit: () => void
}

export function PdfViewer({
  pdfDoc,
  numPages,
  zoom,
  annotations,
  selectedId,
  activeMode,
  viewMode,
  pendingStamp,
  pendingSignature,
  onAnnotationSelect,
  onAnnotationUpdate,
  onAnnotationAdd,
  onGridPageClick,
  onFullscreenExit,
}: PdfViewerProps) {
  const sharedAnnotationProps = {
    pdfDoc,
    zoom,
    annotations,
    selectedId,
    activeMode,
    pendingStamp,
    pendingSignature,
    onAnnotationSelect,
    onAnnotationUpdate,
    onAnnotationAdd,
  }

  if (viewMode === 'spread') {
    return <SpreadView {...sharedAnnotationProps} numPages={numPages} />
  }

  if (viewMode === 'grid') {
    return (
      <GridView
        pdfDoc={pdfDoc}
        numPages={numPages}
        annotations={annotations}
        onPageClick={onGridPageClick}
      />
    )
  }

  if (viewMode === 'fullscreen') {
    return (
      <FullscreenView
        pdfDoc={pdfDoc}
        numPages={numPages}
        annotations={annotations}
        selectedId={selectedId}
        onAnnotationSelect={onAnnotationSelect}
        onAnnotationUpdate={onAnnotationUpdate}
        onExit={onFullscreenExit}
      />
    )
  }

  // Default: single mode
  return (
    <div className="flex flex-col items-center gap-4 py-6 px-4 overflow-auto h-full bg-gray-300">
      {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
        <div key={pageNum} id={`pdf-page-${pageNum}`} className="shadow-xl">
          <PdfPage {...sharedAnnotationProps} pageNumber={pageNum} />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/viewer/__tests__/PdfViewer.test.tsx`
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/viewer/PdfViewer.tsx src/components/viewer/__tests__/PdfViewer.test.tsx
git commit -m "feat: PdfViewer delegates to SpreadView, GridView, FullscreenView based on viewMode"
```

---

## Task 10: App.tsx — full integration

**Files:**
- Modify: `src/App.tsx`

Wire up `appMode` and `viewMode` state, pass new props to `ActionBar`, `Toolbar`, and `PdfViewer`. Add the Electron file-open listener. Handle the cross-mode rule: switching to editor mode while in fullscreen exits fullscreen and returns to single. Handle grid-click scroll-to-page.

- [ ] **Step 1: Read the current `src/App.tsx`**

Read `src/App.tsx` lines 1–221 to confirm the current state before editing.

- [ ] **Step 2: Replace `src/App.tsx` with the integrated version**

```typescript
import React, { useState, useCallback, useEffect, useRef } from 'react'
import { ActionBar } from './components/toolbar/ActionBar'
import { Toolbar } from './components/toolbar/Toolbar'
import { PdfViewer } from './components/viewer/PdfViewer'
import { SignaturePad } from './components/modals/SignaturePad'
import { WatermarkConfig } from './components/modals/WatermarkConfig'
import type { WatermarkSettings } from './components/modals/WatermarkConfig'
import { usePdfDocument } from './hooks/usePdfDocument'
import { useAnnotations } from './hooks/useAnnotations'
import { exportPdf } from './services/pdfExporter'
import type { Annotation } from './types/annotation'
import type { AppMode, ViewMode } from './types/viewModes'
import { MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from './utils/constants'

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [fileBytes, setFileBytes] = useState<ArrayBuffer | null>(null)
  const [zoom, setZoom] = useState(1)
  const [showSignaturePad, setShowSignaturePad] = useState(false)
  const [showWatermarkConfig, setShowWatermarkConfig] = useState(false)
  const [pendingStamp, setPendingStamp] = useState<{ src: string; presetId?: string } | null>(null)
  const [pendingSignature, setPendingSignature] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [appMode, setAppMode] = useState<AppMode>('viewer')
  const [viewMode, setViewMode] = useState<ViewMode>('single')
  const [scrollToPage, setScrollToPage] = useState<number | null>(null)

  const { pdfDoc, numPages, isLoading, error } = usePdfDocument(file)
  const {
    annotations,
    selectedId,
    activeMode,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    selectAnnotation,
    setActiveMode,
  } = useAnnotations()

  // Cache raw bytes for export
  useEffect(() => {
    if (!file) { setFileBytes(null); return }
    let cancelled = false
    file.arrayBuffer().then(buf => { if (!cancelled) setFileBytes(buf) })
    return () => { cancelled = true }
  }, [file])

  // Delete key removes selected annotation (only in editor mode)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && appMode === 'editor') {
        removeAnnotation(selectedId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, removeAnnotation, appMode])

  // Electron: listen for file open events from the main process
  useEffect(() => {
    window.electronAPI?.onOpenFile(async (filePath: string) => {
      try {
        const response = await fetch(`file://${filePath}`)
        const blob = await response.blob()
        const name = filePath.split(/[\\/]/).pop() ?? 'file.pdf'
        const f = new File([blob], name, { type: 'application/pdf' })
        handleUpload(f)
      } catch (err) {
        console.error('Failed to open file from Electron:', err)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to page after switching from grid → single
  const scrollToPageRef = useRef(scrollToPage)
  scrollToPageRef.current = scrollToPage

  useEffect(() => {
    if (viewMode === 'single' && scrollToPage !== null) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`pdf-page-${scrollToPage}`)
        el?.scrollIntoView({ behavior: 'smooth' })
        setScrollToPage(null)
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [viewMode, scrollToPage])

  const handleUpload = useCallback((f: File) => {
    setFile(f)
    setActiveMode(null)
    setPendingStamp(null)
    setPendingSignature(null)
    setViewMode('single')
  }, [setActiveMode])

  const handleAppModeChange = useCallback((mode: AppMode) => {
    setAppMode(mode)
    // Switching to editor while in fullscreen → exit fullscreen, return to single
    if (mode === 'editor') {
      setViewMode(prev => prev === 'fullscreen' ? 'single' : prev)
    }
  }, [])

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode)
  }, [])

  const handleGridPageClick = useCallback((pageNumber: number) => {
    setScrollToPage(pageNumber)
    setViewMode('single')
  }, [])

  const handleFullscreenExit = useCallback(() => {
    setViewMode('single')
  }, [])

  const handleStampSelect = useCallback((src: string, presetId?: string) => {
    setPendingStamp({ src, presetId })
    setActiveMode('stamp')
  }, [setActiveMode])

  const handleAnnotationAdd = useCallback((annotation: Omit<Annotation, 'id'>) => {
    addAnnotation(annotation)
    setPendingStamp(null)
    setPendingSignature(null)
    setActiveMode('select')
  }, [addAnnotation, setActiveMode])

  const handleWatermarkConfirm = useCallback((settings: WatermarkSettings) => {
    addAnnotation({
      type: 'watermark',
      page: 1,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: settings.rotation,
      text: settings.text,
      opacity: settings.opacity,
      fontSize: settings.fontSize,
      color: settings.color,
      allPages: true,
    })
    setShowWatermarkConfig(false)
    setActiveMode('select')
  }, [addAnnotation, setActiveMode])

  const handleExport = useCallback(async () => {
    if (!fileBytes) return
    setIsExporting(true)
    try {
      const blob = await exportPdf(fileBytes, annotations)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const baseName = file ? file.name.replace(/\.pdf$/i, '') : 'document'
      a.download = `${baseName}_annotated.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PDF export failed:', err)
    } finally {
      setIsExporting(false)
    }
  }, [fileBytes, annotations, file])

  const handleZoomIn = useCallback(
    () => setZoom(z => Math.min(+(z + ZOOM_STEP).toFixed(2), MAX_ZOOM)),
    [],
  )
  const handleZoomOut = useCallback(
    () => setZoom(z => Math.max(+(z - ZOOM_STEP).toFixed(2), MIN_ZOOM)),
    [],
  )
  const handleZoomReset = useCallback(() => setZoom(1), [])
  const handleDeleteSelected = useCallback(() => {
    if (selectedId) removeAnnotation(selectedId)
  }, [selectedId, removeAnnotation])
  const handleSignatureClick = useCallback(() => setShowSignaturePad(true), [])
  const handleWatermarkClick = useCallback(() => setShowWatermarkConfig(true), [])

  const handleSignatureConfirm = useCallback((dataUrl: string) => {
    setPendingSignature(dataUrl)
    setShowSignaturePad(false)
    setActiveMode('signature')
  }, [setActiveMode])

  const handleSignatureCancel = useCallback(() => {
    setShowSignaturePad(false)
    setActiveMode('select')
  }, [setActiveMode])

  const handleWatermarkCancel = useCallback(() => {
    setShowWatermarkConfig(false)
    setActiveMode('select')
  }, [setActiveMode])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-900">
      <ActionBar
        hasPdf={!!pdfDoc}
        appMode={appMode}
        viewMode={viewMode}
        onUpload={handleUpload}
        onExport={handleExport}
        isExporting={isExporting}
        onAppModeChange={handleAppModeChange}
        onViewModeChange={handleViewModeChange}
      />

      <div className="flex flex-1 overflow-hidden">
        <Toolbar
          activeMode={activeMode}
          selectedId={selectedId}
          zoom={zoom}
          hasPdf={!!pdfDoc}
          appMode={appMode}
          viewMode={viewMode}
          onModeChange={setActiveMode}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          onDeleteSelected={handleDeleteSelected}
          onStampSelect={handleStampSelect}
          onSignatureClick={handleSignatureClick}
          onWatermarkClick={handleWatermarkClick}
        />

        <main className="flex-1 overflow-hidden">
          {error && (
            <div className="flex items-center justify-center h-full text-red-400 p-4">
              Failed to load PDF: {error}
            </div>
          )}
          {isLoading && (
            <div className="flex items-center justify-center h-full text-gray-400">
              Loading PDF…
            </div>
          )}
          {!pdfDoc && !isLoading && !error && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 select-none">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-lg">Drop a PDF here or click Upload PDF</p>
            </div>
          )}
          {pdfDoc && (
            <PdfViewer
              pdfDoc={pdfDoc}
              numPages={numPages}
              zoom={zoom}
              annotations={annotations}
              selectedId={selectedId}
              activeMode={activeMode}
              viewMode={viewMode}
              pendingStamp={pendingStamp}
              pendingSignature={pendingSignature}
              onAnnotationSelect={selectAnnotation}
              onAnnotationUpdate={updateAnnotation}
              onAnnotationAdd={handleAnnotationAdd}
              onGridPageClick={handleGridPageClick}
              onFullscreenExit={handleFullscreenExit}
            />
          )}
        </main>
      </div>

      {showSignaturePad && (
        <SignaturePad
          onConfirm={handleSignatureConfirm}
          onCancel={handleSignatureCancel}
        />
      )}

      {showWatermarkConfig && (
        <WatermarkConfig
          onConfirm={handleWatermarkConfirm}
          onCancel={handleWatermarkCancel}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: all tests PASS. No regressions in existing hook/utility tests.

- [ ] **Step 4: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Smoke-test in the browser**

Run: `npm run dev:vite`
Open `http://localhost:5173`. Verify:
- Default state is Viewer mode (Stamp/Signature/Watermark/Delete hidden, Export hidden)
- Upload a PDF → view mode buttons appear
- Toggle to Editor mode → tools and Export appear
- Single/Spread/Grid/Fullscreen buttons switch layouts
- Grid thumbnail click → switches to single and scrolls to page
- Fullscreen arrow keys navigate pages; Escape returns to single

- [ ] **Step 6: Smoke-test Electron**

Run: `npm run dev`
Expected: Vite dev server starts, then Electron window opens to `http://localhost:5173`. Verify the same behavior as above in the Electron window.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire appMode/viewMode state, Electron file listener, and cross-mode rules in App.tsx"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ AppMode default: `viewer` — `useState<AppMode>('viewer')` in App.tsx
- ✅ Mode persists across file changes — state lives in App.tsx, not reset on upload
- ✅ Viewer hides Stamp/Signature/Watermark/Delete — Task 5 Toolbar
- ✅ Viewer hides Export — Task 4 ActionBar
- ✅ View mode buttons always visible when PDF loaded — Task 4 ActionBar
- ✅ Single: unchanged stacked layout — Task 9 PdfViewer default branch
- ✅ Spread: 2-column pairs, vertical scroll, odd page alone left — Task 6 SpreadView
- ✅ Grid: 3-col, zoom 0.3, click → single + scroll — Tasks 7 + 10
- ✅ Fullscreen: OS fullscreen, auto-scale, arrow/PageUp/PageDown, Escape → single — Task 8
- ✅ Fullscreen page overlay fades after 2s — Task 8 FullscreenView
- ✅ Editor + fullscreen → exit fullscreen → single — Task 10 handleAppModeChange
- ✅ Electron main: BrowserWindow, Windows file assoc (process.argv), macOS (open-file) — Task 3
- ✅ Electron preload: contextBridge onOpenFile — Task 3
- ✅ App.tsx Electron listener — Task 10
- ✅ window.electronAPI optional (browser still works) — conditional `?.` in App.tsx
- ✅ vite.config.ts fixed port + base './' — Task 2
- ✅ package.json main + scripts + deps — Task 2
