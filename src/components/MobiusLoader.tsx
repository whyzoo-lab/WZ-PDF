import { useEffect, useRef } from 'react'
import { loaderDrawn, loaderMounted } from '../services/loaderSignal'

/**
 * The "opening…" animation (drawing: services/mobiusDraw.ts).
 *
 * Drawn by a worker on an OffscreenCanvas where the browser has one, so it
 * keeps moving while the page's main thread is busy opening the document —
 * which is exactly when it is shown (services/mobiusWorker.ts says more).
 * Elsewhere it runs on the page.
 *
 * Every loader takes its time from one clock, so the view's "loading…" that
 * replaces the app's "opening…" carries on the same motion rather than
 * starting over.
 *
 * Shown at half opacity: at full strength it was too heavy for a spinner.
 */

const EPOCH = typeof performance !== 'undefined' ? performance.now() : 0

export default function MobiusLoader({ size = 150 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const html = document.documentElement
    const isDark = () => html.classList.contains('dark')
    const start = {
      size,
      dpr: Math.min(window.devicePixelRatio || 1, 3),
      dark: isDark(),
      still: !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      elapsed: (performance.now() - EPOCH) / 1000,
    }

    loaderMounted()
    let worker: Worker | null = null
    if (typeof Worker !== 'undefined' && 'transferControlToOffscreen' in canvas) {
      try {
        worker = new Worker(new URL('../services/mobiusWorker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = e => { if ((e.data as { type?: string })?.type === 'drawn') loaderDrawn() }
        const off = canvas.transferControlToOffscreen()
        worker.postMessage({ type: 'start', canvas: off, ...start }, [off])
      } catch {
        // A worker that could not start: draw on the page — unless the canvas
        // was already handed over, which cannot be undone.
        worker?.terminate()
        worker = null
      }
    }

    let cancelled = false
    let run: { setDark(dark: boolean): void; stop(): void } | null = null
    if (!worker) {
      let ctx: CanvasRenderingContext2D | null = null
      try { ctx = canvas.getContext('2d') } catch { /* no canvas (tests), or already transferred */ }
      if (ctx) {
        canvas.width = Math.round(size * start.dpr)
        canvas.height = Math.round(size * start.dpr)
        const page = ctx
        // The drawing code stays off the startup bundle on this path too.
        void import('../services/mobiusDraw').then(({ runLoader }) => {
          if (!cancelled) run = runLoader(page, start, cb => requestAnimationFrame(cb), id => cancelAnimationFrame(id), () => performance.now())
          loaderDrawn()
        })
      } else {
        loaderDrawn()
      }
    }

    // The theme can change while it shows.
    const watch = new MutationObserver(() => {
      if (worker) worker.postMessage({ type: 'dark', dark: isDark() })
      else run?.setDark(isDark())
    })
    watch.observe(html, { attributes: true, attributeFilter: ['class'] })
    return () => {
      cancelled = true
      watch.disconnect()
      worker?.terminate()
      run?.stop()
    }
  }, [size])

  return <canvas ref={ref} aria-hidden="true" style={{ width: size, height: size, opacity: 0.5 }} />
}
