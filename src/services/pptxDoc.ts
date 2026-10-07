// src/services/pptxDoc.ts
//
// PowerPoint (.pptx) via @aiden0z/pptx-renderer — chosen for the visual
// regression suite it runs against PowerPoint's own output, and checked on real
// Korean proposal decks before it was wired in.
//
// The library's own viewer (PptxViewer) owns its container: its list, its
// scaling, its scrolling. Here each slide is rendered on its own
// (`renderSlide`) into a box React lays out, because the app needs to decide
// slide size (zoom), what fullscreen looks like and what printing prints — all
// three are things PptxViewer would otherwise fight over.
//
// Safety. Slide text is set through textContent and links are limited to
// http/https/mailto by the library. What it does do is load pictures, video
// and audio a slide *links to* rather than carries (`TargetMode="External"`)
// straight from the network — the same tracking pixel mail withholds. The
// desktop app's CSP already refuses those; for the web build they are removed
// before the model is built, by rewriting the relationship parts we hand over.
// The library itself is not patched (see "Never patch a dependency in place").

import {
  parseZipLazyMedia, buildPresentation, renderSlide, RECOMMENDED_ZIP_LIMITS,
  type PptxFiles, type PresentationData, type SlideHandle,
} from '@aiden0z/pptx-renderer'

export type { PresentationData, SlideHandle }

const HYPERLINK_TYPE = /\/hyperlink$/

/**
 * Drop every external relationship that is not a hyperlink from one .rels part.
 * A hyperlink only fetches when the reader clicks it, and then outside the app.
 */
export function stripExternalMedia(relsXml: string): string {
  if (!/TargetMode\s*=\s*["']External["']/i.test(relsXml)) return relsXml
  const doc = new DOMParser().parseFromString(relsXml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return relsXml
  let removed = false
  for (const rel of Array.from(doc.getElementsByTagName('Relationship'))) {
    const external = (rel.getAttribute('TargetMode') ?? '').trim().toLowerCase() === 'external'
    if (external && !HYPERLINK_TYPE.test(rel.getAttribute('Type') ?? '')) {
      rel.remove()
      removed = true
    }
  }
  return removed ? new XMLSerializer().serializeToString(doc) : relsXml
}

function stripAll(files: PptxFiles): void {
  files.presentationRels = stripExternalMedia(files.presentationRels)
  for (const map of [files.slideRels, files.slideLayoutRels, files.slideMasterRels, files.chartRels]) {
    if (!map) continue
    for (const [path, xml] of map) map.set(path, stripExternalMedia(xml))
  }
}

/** Parse a deck. Media is decoded when a slide first needs it. */
export async function loadPptx(bytes: ArrayBuffer): Promise<PresentationData> {
  const files = await parseZipLazyMedia(bytes, RECOMMENDED_ZIP_LIMITS)
  stripAll(files)
  return buildPresentation(files, { lazySlides: true })
}

export interface SlideRenderContext {
  /** Shared blob URLs for pictures — revoke them all when the deck closes. */
  mediaUrlCache: Map<string, string>
  /** Live chart instances — dispose them when the deck closes. */
  chartInstances: Set<{ dispose(): void }>
  onNavigate: (target: { slideIndex?: number; url?: string }) => void
}

export function createRenderContext(onNavigate: SlideRenderContext['onNavigate']): SlideRenderContext {
  return { mediaUrlCache: new Map(), chartInstances: new Set(), onNavigate }
}

/** Render one slide at its intrinsic size (presentation.width × height px). */
export function renderOneSlide(pres: PresentationData, index: number, ctx: SlideRenderContext): SlideHandle {
  return renderSlide(pres, pres.slides[index], {
    mediaUrlCache: ctx.mediaUrlCache,
    chartInstances: ctx.chartInstances as never,
    onNavigate: ctx.onNavigate,
    // The EMF-with-PDF-preview fallback would import its own copy of pdfjs by
    // URL. Off: everything else renders without it.
    pdfjs: false,
  })
}

export function disposeRenderContext(ctx: SlideRenderContext): void {
  for (const chart of ctx.chartInstances) {
    try { chart.dispose() } catch { /* already gone */ }
  }
  ctx.chartInstances.clear()
  for (const url of ctx.mediaUrlCache.values()) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }
  ctx.mediaUrlCache.clear()
}

/** A link from a slide, opened outside the app — web and mail only. */
export function isOpenableLink(url: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}
