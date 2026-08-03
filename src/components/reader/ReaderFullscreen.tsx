import { useCallback, useEffect, useRef, useState } from 'react'
import { PresentationOverlay } from '../viewer/PresentationOverlay'
import { PresentationHud } from '../viewer/PresentationHud'
import { DEFAULT_TOOL_STATE, isDrawingTool, reducePresentTool, spotZoomStyle } from '../../utils/presentTools'
import type { PresentStroke, PresentToolState } from '../../types/present'

interface ReaderFullscreenProps {
  /** The document body to present — already rendered and sanitized. */
  children: React.ReactNode
  /** Called once the browser has actually left fullscreen. */
  onExit: () => void
}

/** Presenting starts larger than reading: a slide is read from across a room. */
const DEFAULT_SCALE = 1.35
const MIN_SCALE = 0.7
const MAX_SCALE = 3
const SCALE_STEP = 0.15
/** Keep a sliver of the previous screen visible so nothing is skipped. */
const PAGE_SCROLL_RATIO = 0.9

type Spot = { scale: number; x: number; y: number } | null

/**
 * Fullscreen presentation for the reflowing formats (Markdown, mail).
 *
 * `FullscreenView` is the page-based equivalent, and the two deliberately do
 * NOT share a shell: that one advances through pages, this one scrolls through
 * one continuous document. What they do share is everything that isn't about
 * pages — `PresentationOverlay`, `PresentationHud` and the ZoomIt-style tool
 * keymap are all page-agnostic, so the presenter tools behave identically here.
 */
export function ReaderFullscreen({ children, onExit }: ReaderFullscreenProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(DEFAULT_SCALE)
  const [tool, setTool] = useState<PresentToolState>(DEFAULT_TOOL_STATE)
  const [strokes, setStrokes] = useState<PresentStroke[]>([])
  const [spot, setSpot] = useState<Spot>(null)

  // Exit exactly once, whether it came from ESC, F11 or the OS.
  const exitedRef = useRef(false)
  const safeExit = useCallback(() => {
    if (exitedRef.current) return
    exitedRef.current = true
    onExit()
  }, [onExit])

  // ── Enter / leave real fullscreen ─────────────────────────────────────────
  useEffect(() => {
    const el = document.documentElement
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => undefined)
    // Same rule as FullscreenView: never call onExit() straight from a key
    // handler. Ask the browser to leave fullscreen and let the resulting event
    // unmount us, or React tears the element down while it is still fullscreen
    // and the window visibly snaps to the wrong size.
    const onChange = () => { if (!document.fullscreenElement) safeExit() }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined)
    }
  }, [safeExit])

  // Stops the browser from swallowing ESC before any handler sees it, which is
  // what makes the two-step (clear presenter state → exit) possible.
  useEffect(() => {
    type KbLockNav = Navigator & { keyboard?: { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void } }
    const kb = (navigator as KbLockNav).keyboard
    kb?.lock?.(['Escape'])?.catch(() => undefined)
    return () => kb?.unlock?.()
  }, [])

  const scrollByScreen = useCallback((dir: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ top: dir * el.clientHeight * PAGE_SCROLL_RATIO, behavior: 'smooth' })
  }, [])

  // ── Presenter keymap ──────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        // 1st press clears presenter state; 2nd (with nothing to clear) exits.
        if (strokes.length > 0 || tool.kind !== null || spot) {
          setStrokes([]); setTool(DEFAULT_TOOL_STATE); setSpot(null)
          return
        }
        if (document.fullscreenElement) document.exitFullscreen().catch(safeExit)
        else safeExit()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); setStrokes(s => s.slice(0, -1)); return
      }
      if (e.key.toLowerCase() === 'e') { e.preventDefault(); setStrokes([]); return }

      const next = reducePresentTool(tool, e.key)
      if (next) {
        e.preventDefault()
        setTool(next)
        if (next.kind === 'zoom') setSpot({ scale: 2, x: window.innerWidth / 2, y: window.innerHeight / 2 })
        else if (tool.kind === 'zoom') setSpot(null)
        return
      }

      // Text size. `=` is the unshifted `+` on most layouts.
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setScale(s => Math.min(MAX_SCALE, s + SCALE_STEP)); return }
      if (e.key === '-') { e.preventDefault(); setScale(s => Math.max(MIN_SCALE, s - SCALE_STEP)); return }
      if (e.key === '0') { e.preventDefault(); setScale(DEFAULT_SCALE); return }

      // Navigation. A continuous document has no pages, so the keys a presenter
      // (or a USB clicker) reaches for scroll by a screenful instead.
      const el = scrollRef.current
      if (e.key === 'PageDown' || e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault(); scrollByScreen(1); return
      }
      if (e.key === 'PageUp' || e.key === 'ArrowLeft' || e.key === 'Backspace') {
        e.preventDefault(); scrollByScreen(-1); return
      }
      if (e.key === 'Home') { e.preventDefault(); el?.scrollTo({ top: 0, behavior: 'smooth' }); return }
      if (e.key === 'End') { e.preventDefault(); el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tool, strokes, spot, safeExit, scrollByScreen])

  // ── Spotlight follows the cursor ──────────────────────────────────────────
  useEffect(() => {
    if (!spot) return
    const onMove = (e: MouseEvent) => setSpot(s => (s ? { ...s, x: e.clientX, y: e.clientY } : s))
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [spot])

  // Ctrl+wheel resizes the text; with the spotlight up it scales the spotlight.
  // Registered non-passive because both cases preventDefault.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (spot) {
        e.preventDefault()
        setSpot(s => (s ? { ...s, scale: Math.min(5, Math.max(1.5, s.scale - e.deltaY * 0.002)) } : s))
        return
      }
      if (!e.ctrlKey) return
      e.preventDefault()
      setScale(s => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s - e.deltaY * 0.002)))
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [spot])

  return (
    <div className="fixed inset-0 z-50 bg-gray-900">
      <div
        ref={scrollRef}
        className="h-full overflow-auto"
        // While a drawing tool is armed the pointer belongs to the overlay, so
        // text selection under it would only produce accidental highlights.
        style={{ userSelect: isDrawingTool(tool.kind) ? 'none' : undefined }}
      >
        <div
          className="mx-auto my-10 max-w-4xl bg-white px-12 py-10 shadow-2xl"
          style={{
            fontSize: `${scale}rem`,
            ...(spot ? spotZoomStyle(spot.scale, spot.x, spot.y) : {}),
          }}
        >
          {children}
        </div>
      </div>

      <PresentationOverlay
        strokes={strokes}
        tool={tool}
        onAddStroke={(s) => setStrokes(prev => [...prev, s])}
      />
      <PresentationHud tool={tool} />
    </div>
  )
}
