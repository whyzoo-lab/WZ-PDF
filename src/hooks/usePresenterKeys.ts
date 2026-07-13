import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { ZOOM_STEP, MIN_ZOOM, MAX_ZOOM } from '../utils/constants'
import { reducePresentTool, DEFAULT_TOOL_STATE } from '../utils/presentTools'
import type { PresentStroke, PresentToolState } from '../types/present'

type Spot = { scale: number; x: number; y: number } | null

interface PresenterKeysDeps {
  step: number
  maxPage: number
  safeExit: () => void
  tool: PresentToolState
  strokes: PresentStroke[]
  spot: Spot
  setStrokes: Dispatch<SetStateAction<PresentStroke[]>>
  setTool: Dispatch<SetStateAction<PresentToolState>>
  setSpot: Dispatch<SetStateAction<Spot>>
  setCurrentPage: Dispatch<SetStateAction<number>>
  setZoom: Dispatch<SetStateAction<number>>
}

/**
 * Fullscreen presenter keymap (ZoomIt-style): ESC two-step (clear presenter
 * state → exit), Ctrl+Z undo / E erase, tool hotkeys, page navigation
 * (arrows / PageUp-Down / Space / Enter / Backspace, USB-clicker friendly),
 * Home/End, and +/- zoom.
 */
export function usePresenterKeys({
  step, maxPage, safeExit, tool, strokes, spot,
  setStrokes, setTool, setSpot, setCurrentPage, setZoom,
}: PresenterKeysDeps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        // 1st press: clear any presenter state. 2nd press (clean): exit.
        if (strokes.length > 0 || tool.kind !== null || spot) {
          setStrokes([]); setTool(DEFAULT_TOOL_STATE); setSpot(null)
          return
        }
        if (document.fullscreenElement) {
          document.exitFullscreen().then(safeExit).catch(safeExit)
        } else {
          safeExit()
        }
        return
      }

      // ── Presenter tools (ZoomIt-style) ──────────────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { // undo last stroke
        e.preventDefault(); setStrokes(s => s.slice(0, -1)); return
      }
      if (e.key.toLowerCase() === 'e') { e.preventDefault(); setStrokes([]); return } // erase all
      {
        const next = reducePresentTool(tool, e.key)
        if (next) {
          e.preventDefault()
          setTool(next)
          if (next.kind === 'zoom') setSpot({ scale: 2, x: window.innerWidth / 2, y: window.innerHeight / 2 })
          else if (tool.kind === 'zoom') setSpot(null)
          return
        }
      }

      // ── Next page: Arrow→, Arrow↓, PageDown, Space, Enter
      // Space & Enter cover most USB presentation clickers that don't send
      // PageDown. Backspace covers the 'back' button on clickers.
      if (
        e.key === 'ArrowRight' || e.key === 'ArrowDown' ||
        e.key === 'PageDown' ||
        e.key === ' '         ||  // Space  (most USB clickers)
        e.key === 'Enter'         // Enter
      ) {
        e.preventDefault()
        setCurrentPage(p => Math.min(p + step, maxPage))
        return
      }

      // ── Previous page: Arrow←, Arrow↑, PageUp, Backspace
      if (
        e.key === 'ArrowLeft' || e.key === 'ArrowUp' ||
        e.key === 'PageUp'    ||
        e.key === 'Backspace'     // Back button on USB clickers
      ) {
        e.preventDefault()
        setCurrentPage(p => Math.max(p - step, 1))
        return
      }

      // ── Home → first page, End → last page
      if (e.key === 'Home') {
        e.preventDefault()
        setCurrentPage(1)
        return
      }
      if (e.key === 'End') {
        e.preventDefault()
        setCurrentPage(maxPage)
        return
      }

      // ── Zoom: + / = (in), - (out)
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        setZoom(z => +(Math.min(MAX_ZOOM, z + ZOOM_STEP).toFixed(2)))
      } else if (e.key === '-') {
        e.preventDefault()
        setZoom(z => +(Math.max(MIN_ZOOM, z - ZOOM_STEP).toFixed(2)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, maxPage, safeExit, tool, strokes, spot, setStrokes, setTool, setSpot, setCurrentPage, setZoom])
}
