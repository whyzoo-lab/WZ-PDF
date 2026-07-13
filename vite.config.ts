/// <reference types="vitest" />
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json' with { type: 'json' }

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
        // NOTE: do NOT add @paddleocr / onnxruntime-web / opencv-js here. Forcing
        // them into a manual chunk made rolldown hoist that chunk into the entry's
        // STATIC graph (a `import "./vendor-paddleocr.js"` at the top of the entry
        // + a modulepreload), so the OCR runtime evaluated at startup. That runs
        // opencv's emscripten `new Function(...)`, which the packaged app's CSP
        // (script-src without 'unsafe-eval') blocks → the renderer died with a
        // blank screen. Left alone, the OCR deps stay inside the dynamically
        // imported `ocrEngine` chunk and only load when the user runs OCR.
        manualChunks: (id: string) => {
          // pdfjs main-thread code (getDocument, TextLayer, worker-src setup) —
          // split into its own vendor chunk so it caches independently across
          // releases. The pdfjs Worker bundle is emitted separately by Vite.
          if (id.includes('node_modules/pdfjs-dist')) return 'vendor-pdfjs'
          // Konva stack FIRST: 'node_modules/react-konva' and 'react-reconciler'
          // both contain the substring 'node_modules/react', so the react branch
          // below would otherwise swallow them into vendor-react. Order matters.
          if (
            id.includes('node_modules/konva') ||
            id.includes('node_modules/react-konva') ||
            id.includes('node_modules/react-reconciler')
          ) {
            return 'vendor-konva'
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
