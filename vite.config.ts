/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json' with { type: 'json' }

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
      output: {
        // Split heavy third-party libs into stable vendor chunks so they cache
        // independently from app code. pdfjs is loaded as a separate Worker
        // (handled by Vite automatically) so it's not listed here. Rolldown
        // exposes manualChunks only via the function form.
        manualChunks: (id: string) => {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/konva') || id.includes('node_modules/react-konva')) {
            return 'vendor-konva'
          }
          if (id.includes('node_modules/@paddleocr') || id.includes('onnxruntime-web') || id.includes('@techstark/opencv-js')) {
            return 'vendor-paddleocr'
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
