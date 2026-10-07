import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  loadPptx, renderOneSlide, createRenderContext, disposeRenderContext, isOpenableLink,
  type PresentationData, type SlideHandle,
} from '../../services/pptxDoc'
import { FLOW_PRINT_ATTR } from '../../services/htmlPrint'
import type { PdfJob } from '../../services/officePdf'
import { pptxPdfJob } from '../../services/officePdfJobs'
import { pptxText } from '../../services/ooxmlText'
import { ReaderFullscreen } from '../reader/ReaderFullscreen'
import { OfficePagePanel } from './OfficePagePanel'
import { SlideCaptions } from './SlideCaptions'
import { GRID_PAGE_PX, GUTTER_PX, PAGE_GAP_PX, type OfficeViewProps } from './officeView'
import { t } from '../../i18n'

interface PptxViewProps extends OfficeViewProps {
  bytes: ArrayBuffer
}

/** Widest a slide is drawn at zoom 1, however large the window. */
const MAX_SLIDE_PX = 1280
/** Height kept free under a slide for its speaker notes at zoom 1. */
const NOTES_ROOM_PX = 150

type Loaded = { src: ArrayBuffer; pres: PresentationData | null }

/**
 * The slide not yet rendered that is closest to the screen, and whether it is
 * on it or within a screen of it. Slides without a box (hidden ones during a
 * slideshow) come last, in order.
 */
function nearestPending(
  boxes: Map<number, HTMLElement>, made: Map<number, unknown>, failed: Set<number>, total: number,
): { index: number; visible: boolean } | null {
  const viewH = window.innerHeight
  let best: { index: number; dist: number } | null = null
  for (let i = 0; i < total; i++) {
    if (made.has(i) || failed.has(i)) continue
    const box = boxes.get(i)
    let dist = Number.MAX_SAFE_INTEGER - (total - i)
    if (box) {
      const r = box.getBoundingClientRect()
      dist = r.bottom < 0 ? -r.bottom : r.top > viewH ? r.top - viewH : 0
    }
    if (!best || dist < best.dist) best = { index: i, dist }
  }
  return best && { index: best.index, visible: best.dist < viewH }
}

/**
 * Reads a PowerPoint deck with the PDF viewer's controls: one slide per row,
 * two per row, or all of them as a grid; a page list on the left; fullscreen
 * is a slideshow, one slide per screen.
 *
 * Slides are DOM the library builds, not React output. Each is rendered once
 * per deck, kept in `handles`, and moved into whichever box is on screen for
 * its index — so switching layout or going fullscreen never renders the deck
 * again.
 */
export function PptxView({
  bytes, zoom, fullscreen, onExitFullscreen, viewMode, onViewModeChange, panelOpen, handleRef, onPageInfo,
  showNotes = true, fullscreenStartPage = 1,
}: PptxViewProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState<ArrayBuffer | null>(null)

  // ── Speaker notes: the presentation script ────────────────────────────────
  // Read straight from the file (services/ooxmlText.ts) — the renderer does
  // not surface them. One entry per slide, in the deck's own order, which is
  // the order the renderer's slides come in.
  const [notesFor, setNotesFor] = useState<{ src: ArrayBuffer; notes: string[] } | null>(null)
  useEffect(() => {
    let cancelled = false
    pptxText(bytes)
      .then(slides => { if (!cancelled) setNotesFor({ src: bytes, notes: slides.map(s => s.notes) }) })
      .catch(err => console.error('Speaker notes could not be read:', err))
    return () => { cancelled = true }
  }, [bytes])
  const notes = notesFor?.src === bytes ? notesFor.notes : null
  const hasNotes = !!notes?.some(Boolean)

  useEffect(() => {
    let cancelled = false
    loadPptx(bytes)
      .then(pres => { if (!cancelled) setLoaded({ src: bytes, pres }) })
      .catch(err => {
        console.error('PowerPoint read failed:', err)
        if (!cancelled) setFailed(bytes)
      })
    return () => { cancelled = true }
  }, [bytes])

  const pres = loaded && loaded.src === bytes ? loaded.pres : null

  // ── Slides, rendered once per deck and parked in their boxes ──────────────
  const handles = useRef(new Map<number, SlideHandle>())
  const boxes = useRef(new Map<number, HTMLElement>())
  /** Bumped as slides are drawn, so the page list copies the new ones. */
  const [drawn, setDrawn] = useState(0)
  /** Renders every slide not yet drawn, at once — for a PDF of the deck. */
  const renderAll = useRef<() => void>(() => undefined)
  const place = useCallback((index: number) => {
    const handle = handles.current.get(index)
    const box = boxes.current.get(index)
    if (handle && box && handle.element.parentNode !== box) box.appendChild(handle.element)
  }, [])
  const boxRef = useCallback((index: number) => (el: HTMLElement | null) => {
    if (el) { boxes.current.set(index, el); place(index) } else boxes.current.delete(index)
  }, [place])

  useEffect(() => {
    if (!pres) return
    const ctx = createRenderContext(target => {
      // A link to another slide in the deck (an agenda, an action button).
      if (target.slideIndex !== undefined) {
        boxes.current.get(target.slideIndex)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      else if (target.url && isOpenableLink(target.url)) window.open(target.url, '_blank', 'noopener,noreferrer')
    })
    const made = handles.current
    const failed = new Set<number>()
    const total = pres.slides.length
    let timer = 0
    let idle = 0
    const render = (index: number) => {
      try {
        const handle = renderOneSlide(pres, index, ctx)
        // Scaled by the box it sits in (see .wz-slide in index.css), so a
        // zoom or a resize never re-renders it.
        handle.element.style.transform = 'scale(var(--wz-slide-scale))'
        handle.element.style.transformOrigin = 'top left'
        made.set(index, handle)
        place(index)
      } catch (err) {
        failed.add(index)
        console.error(`Slide ${index + 1} failed to render:`, err)
      }
    }
    // One slide costs ~300–650 ms (measured on real Korean decks): the library
    // attaches it to the page to measure its text, and cannot be split. So the
    // slides on screen go first, straight away, and the rest only when the
    // browser is idle — rendering a 25-slide deck front to back froze
    // scrolling for ~10 s.
    const step = () => {
      const near = nearestPending(boxes.current, made, failed, total)
      if (near === null) return
      render(near.index)
      setDrawn(made.size)
      if (made.size + failed.size >= total) return
      const again = nearestPending(boxes.current, made, failed, total)
      if (again?.visible) timer = window.setTimeout(step, 0)
      else if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(step)
      else timer = window.setTimeout(step, 50)
    }
    timer = window.setTimeout(step, 0)
    renderAll.current = () => {
      for (let i = 0; i < total; i++) if (!made.has(i) && !failed.has(i)) render(i)
      setDrawn(made.size)
    }
    // Scrolling brings new slides into view; render those before the rest.
    const onScroll = () => {
      const near = nearestPending(boxes.current, made, failed, total)
      if (near?.visible) {
        window.cancelIdleCallback?.(idle)
        window.clearTimeout(timer)
        timer = window.setTimeout(step, 0)
      }
    }
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.clearTimeout(timer)
      window.cancelIdleCallback?.(idle)
      renderAll.current = () => undefined
      for (const h of made.values()) {
        try { h.dispose() } catch { /* already gone */ }
        h.element.remove()
      }
      made.clear()
      disposeRenderContext(ctx)
    }
  }, [pres, place])

  // ── Size: fit the column, then the reader's zoom ──────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null)
  const [column, setColumn] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setColumn(c => (c.w === el.clientWidth && c.h === el.clientHeight ? c : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    // Both: the observer catches the pane changing width on its own (the page
    // list opening), the window event a resize Chromium defers the observer for.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [pres, fullscreen, panelOpen])

  const [screen, setScreen] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    if (!fullscreen) return
    const onResize = () => setScreen({ w: window.innerWidth, h: window.innerHeight })
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fullscreen])

  const W = pres?.width ?? 1
  const H = pres?.height ?? 1
  const perRow = viewMode === 'spread' ? 2 : 1
  // A whole slide (a row of two, in the two-page layout) fits the window at
  // zoom 1, as a PDF page opens: a portrait deck fitted to the width alone
  // opened with each slide taller than the window.
  const rowWidth = (column.w - GUTTER_PX - PAGE_GAP_PX * (perRow - 1)) / perRow
  // With the script showing, a slide leaves room under it for its notes, as
  // PowerPoint's normal view does — fitted to the whole window, the notes sat
  // just below the bottom edge and every slide needed a scroll to read them.
  const notesRoom = showNotes && hasNotes && viewMode !== 'grid' ? NOTES_ROOM_PX : 0
  const fit = column.w > 0
    ? Math.min(Math.min(MAX_SLIDE_PX, rowWidth) / W, (column.h - GUTTER_PX - notesRoom) / H)
    : 1
  const scale = viewMode === 'grid' ? GRID_PAGE_PX / W : Math.max(0.05, fit * zoom)

  // ── Which slide is on screen ──────────────────────────────────────────────
  const [current, setCurrent] = useState(1)
  // Where the reader is, as a fraction of the whole column — kept so a zoom
  // or a layout change lands on the same slide instead of the same pixel.
  const position = useRef(0)
  const onScrollList = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    position.current = el.scrollHeight > 0 ? el.scrollTop / el.scrollHeight : 0
    const line = el.getBoundingClientRect().top + el.clientHeight * 0.3
    let page = 1
    for (const [i, box] of boxes.current) {
      if (box.getBoundingClientRect().top <= line) page = Math.max(page, i + 1)
    }
    setCurrent(page)
  }, [])
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = position.current * el.scrollHeight
  }, [scale, viewMode])
  const count = pres?.slides.length ?? 0
  useEffect(() => {
    onPageInfo?.(count ? { count, current: Math.min(current, count), hasNotes } : null)
  }, [count, current, hasNotes, onPageInfo])
  useEffect(() => () => onPageInfo?.(null), [onPageInfo])

  const goTo = useCallback((page: number) => {
    boxes.current.get(page - 1)?.scrollIntoView({ block: 'start' })
    setCurrent(page)
  }, [])

  // ── Slideshow: where it opens, which slide is up, its captions ────────────
  /** The script as subtitles in the slideshow; C or the corner button toggles. */
  const [captionsOn, setCaptionsOn] = useState(true)
  const toggleCaptions = useCallback(() => setCaptionsOn(on => !on), [])
  const [fsSlide, setFsSlide] = useState(0)
  /**
   * The slide the slideshow is held on until the reader moves. Going
   * fullscreen resizes the window after the slides are laid out, and every
   * section is a screen tall, so a scroll made before that lands between
   * slides — it is made again on each resize until the first key or wheel.
   */
  const fsTarget = useRef<number | null>(null)
  const showSlide = useCallback((index: number) => {
    boxes.current.get(index)?.closest('section')?.scrollIntoView({ block: 'start' })
  }, [])
  useLayoutEffect(() => {
    if (!fullscreen || !pres) { fsTarget.current = null; return }
    // F5 opens on slide 1, Alt+F5 on the one in view. A hidden slide is not
    // in the slideshow, so it opens on the next one shown (or the last).
    const shown = pres.slides.map((s, i) => (s.hidden ? -1 : i)).filter(i => i >= 0)
    const from = fullscreenStartPage - 1
    const target = shown.find(i => i >= from) ?? shown[shown.length - 1]
    if (target === undefined) return
    fsTarget.current = target
    showSlide(target)
    const release = () => { fsTarget.current = null }
    window.addEventListener('keydown', release, true)
    window.addEventListener('wheel', release, true)
    window.addEventListener('pointerdown', release, true)
    return () => {
      window.removeEventListener('keydown', release, true)
      window.removeEventListener('wheel', release, true)
      window.removeEventListener('pointerdown', release, true)
    }
  }, [fullscreen, pres, fullscreenStartPage, showSlide])
  useLayoutEffect(() => {
    if (fullscreen && fsTarget.current !== null) showSlide(fsTarget.current)
  }, [fullscreen, screen, showSlide])
  useEffect(() => {
    if (!fullscreen) return
    // The slide whose top is nearest the top of the screen — each fills it.
    const onScroll = () => {
      let best = 0
      let bestDist = Infinity
      for (const [i, box] of boxes.current) {
        const dist = Math.abs(box.closest('section')?.getBoundingClientRect().top ?? Infinity)
        if (dist < bestDist) { bestDist = dist; best = i }
      }
      setFsSlide(best)
    }
    window.addEventListener('scroll', onScroll, true)
    const first = window.setTimeout(onScroll, 0)
    return () => {
      window.clearTimeout(first)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [fullscreen])

  // A slide clicked in the all-slides grid opens there in the one-per-row view.
  const [pendingPage, setPendingPage] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (pendingPage === null || viewMode === 'grid') return
    // Scrolling reports the page through the scroll handler.
    boxes.current.get(pendingPage - 1)?.scrollIntoView({ block: 'start' })
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot: the jump has been made
    setPendingPage(null)
  }, [pendingPage, viewMode])

  // ── What the app can ask of this view ─────────────────────────────────────
  const metrics = useRef({ rowWidth, fit, mode: viewMode, current, notes })
  useLayoutEffect(() => { metrics.current = { rowWidth, fit, mode: viewMode, current, notes } })
  useEffect(() => {
    if (!pres) return
    handleRef.current = {
      fitWidth: () => {
        const m = metrics.current
        if (m.mode === 'grid' || m.fit <= 0) return null
        return (m.rowWidth / pres.width) / m.fit
      },
      goTo,
      // A deck with a script is read from its script, from the slide on
      // screen on; slides without notes are passed over. A deck without one
      // is read from what the slides say (null: the visible text).
      speechText: () => {
        const { notes: all, current: from } = metrics.current
        if (!all?.some(Boolean)) return null
        return all.slice(Math.max(0, from - 1)).filter(Boolean).join('\n\n')
      },
      pdfJob: async (): Promise<PdfJob> => {
        renderAll.current()
        return pptxPdfJob(
          { width: pres.width, height: pres.height },
          pres.slides.map((s, i) => ({ element: handles.current.get(i)?.element ?? null, hidden: !!s.hidden })),
        )
      },
    }
    return () => { handleRef.current = null }
  }, [pres, handleRef, goTo])

  if (failed === bytes) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-red-400">
        {t('office.pptxFailed')}
      </div>
    )
  }
  if (!pres) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-gray-400 text-sm select-none">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
        {t('url.loading')}
      </div>
    )
  }

  const vars = (s: number) => ({
    '--wz-slide-w': W, '--wz-slide-h': H, '--wz-slide-scale': s,
  } as React.CSSProperties)

  if (fullscreen) {
    // A slideshow skips hidden slides, as PowerPoint's does.
    const shown = pres.slides.map((s, i) => ({ s, i })).filter(({ s }) => !s.hidden)
    // Rounded down: a slide a fraction of a pixel taller than the screen
    // made the next one peek in at the bottom.
    const fsScale = Math.floor(Math.min(screen.w / W, screen.h / H) * 1000) / 1000
    return (
      <ReaderFullscreen onExit={onExitFullscreen} layout="slides">
        <div className="wz-slides" style={vars(fsScale)} {...{ [FLOW_PRINT_ATTR]: '' }}>
          {shown.map(({ i }) => (
            <section key={i} className="wz-slide-screen">
              <div className="wz-slide" ref={boxRef(i)} />
            </section>
          ))}
        </div>
        {hasNotes && (
          <SlideCaptions text={notes?.[fsSlide] ?? ''} on={captionsOn} onToggle={toggleCaptions} />
        )}
      </ReaderFullscreen>
    )
  }

  const layoutClass = viewMode === 'grid'
    ? 'flex flex-row flex-wrap justify-center'
    : viewMode === 'spread' ? 'grid grid-cols-[repeat(2,max-content)] justify-center' : 'flex flex-col items-center'

  return (
    <div className="flex h-full">
      {panelOpen && (
        <OfficePagePanel
          count={count}
          current={current}
          aspect={() => W / H}
          source={i => handles.current.get(i)?.element ?? null}
          version={drawn}
          hidden={i => !!pres.slides[i]?.hidden}
          onPick={goTo}
        />
      )}
      <div ref={scrollRef} onScroll={onScrollList} className="h-full min-w-0 flex-1 overflow-auto bg-gray-300">
        <div
          className={`wz-slides ${layoutClass} py-6`}
          style={{ ...vars(scale), gap: PAGE_GAP_PX, paddingInline: GUTTER_PX / 2 }}
          {...{ [FLOW_PRINT_ATTR]: '' }}
        >
          {pres.slides.map((s, i) => (
            <figure key={i} className="m-0 flex flex-col items-center gap-1.5">
              <div
                className={`wz-slide shadow-lg ${s.hidden ? 'wz-slide-hidden' : ''} ${viewMode === 'grid' ? 'cursor-pointer' : ''}`}
                ref={boxRef(i)}
                role="group"
                aria-label={t('office.slide', { n: i + 1 })}
                onClick={viewMode === 'grid' ? () => { setPendingPage(i + 1); onViewModeChange('single') } : undefined}
              />
              {/* The number is drawn by CSS: find and read-aloud see only slides. */}
              <figcaption
                className="wz-slide-number"
                data-n={s.hidden ? `${i + 1} · ${t('office.slideHidden')}` : String(i + 1)}
              />
              {showNotes && viewMode !== 'grid' && notes?.[i] && (
                // The script for this slide, as PowerPoint's notes pane shows
                // it. Real text, so find matches it and read-aloud highlights
                // the sentence being read here.
                <div className="wz-slide-notes" data-label={t('office.notes')}>
                  {notes[i].split('\n').filter(line => line.trim()).map((line, n) => <p key={n}>{line}</p>)}
                </div>
              )}
            </figure>
          ))}
        </div>
      </div>
    </div>
  )
}
