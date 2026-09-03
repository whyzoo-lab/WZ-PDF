/// <reference types="vitest" />
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json' with { type: 'json' }

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `.ts` before `.js`. tsconfig.electron.json emits `electron/*.js` beside the
  // sources, and with the default order vitest resolved `./security` to the
  // stale compiled file — `security.test.ts` had been testing yesterday's build.
  resolve: {
    extensions: ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx', '.json'],
  },
  // Inject the app version at build time so the renderer can reference
  // package.json's version without bundling the whole file.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  base: './',
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  build: {
    // Bump warning threshold past pdfjs's intrinsic worker size (~1.2 MB).
    // The app chunk itself is the real target of optimization, see manualChunks.
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      // Multi-page: the static landing/demo (index.html) is the root; the React
      // app lives at app.html so it can be embedded via <iframe src="app.html?embed=1&url=…">.
      input: {
        main: r('./index.html'),
        app: r('./app.html'),
      },
      output: {
        // Split heavy third-party libs into stable vendor chunks so they cache
        // independently from app code. pdfjs is loaded as a separate Worker
        // (handled by Vite automatically) so it's not listed here. Rolldown
        // exposes manualChunks only via the function form.
        //
        // NOTE: only list libraries the FIRST PAINT genuinely needs.
        // Forcing a lazily-used library into a manual chunk makes rolldown hoist
        // that chunk into the entry's STATIC graph (an `import "./vendor-x.js"`
        // at the top of the entry + a modulepreload) — which silently cancels
        // any React.lazy/dynamic-import work done to keep it off startup.
        //
        // Two things were bitten by this:
        //  - @paddleocr / onnxruntime-web / opencv-js: the OCR runtime evaluated
        //    at startup, running opencv's emscripten `new Function(...)`, which
        //    the packaged app's CSP (script-src without 'unsafe-eval') blocks →
        //    the renderer died with a blank screen.
        //  - pdfjs-dist + konva/react-konva (~730 KB): both are only needed once
        //    a document is open (the viewer subtree is React.lazy'd and pdfjs is
        //    imported on demand in usePdfDocument), yet the manual chunks pinned
        //    them to the entry, so every cold launch paid for them before the
        //    window could paint. Left unlisted they ride along inside the
        //    dynamically imported PdfViewer chunk and load while the file parses.
        //
        // Only react/react-dom stay split: they ARE in the first paint, and a
        // stable vendor chunk lets them cache across releases.
        manualChunks: (id: string) => {
          // react-konva / react-reconciler also contain the substring
          // 'node_modules/react' — exclude them so they don't get dragged into
          // vendor-react (which IS eager) and undo the lazy loading above.
          if (
            id.includes('node_modules/konva') ||
            id.includes('node_modules/react-konva') ||
            id.includes('node_modules/react-reconciler')
          ) {
            return
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react'
          }
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
