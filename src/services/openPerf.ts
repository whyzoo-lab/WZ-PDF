/**
 * Timing marks for the document-open path.
 *
 * There is an intermittent stall — roughly one launch in twenty in testing —
 * where the app shell paints on schedule (first contentful paint at ~660 ms,
 * indistinguishable from a fast run) and then the first page takes several
 * seconds longer to appear. Because the window is already up, the cost is
 * clearly somewhere between "we have the bytes" and "the page is drawn", but
 * which step is not something a wall-clock total can say.
 *
 * The marks are always recorded — `performance.mark` is a few microseconds and
 * nothing reads them unless asked — so a stall that happens on a user's machine
 * can be broken down after the fact, rather than only when it can be reproduced
 * on demand. `?perf` additionally prints one summary line.
 */

const PREFIX = 'wz:'

export type OpenStage =
  | 'bytes'        // file contents available to the renderer
  | 'engine'       // pdfjs/rhwp module + worker ready
  | 'document'     // getDocument resolved — page count known
  | 'first-page'   // first page rasterised and on screen

export function markOpen(stage: OpenStage): void {
  try {
    // Only the first page of each document is interesting, and the pages after
    // it render constantly. Recording once per open keeps the mark meaningful —
    // and must be decided from the marks themselves, not a module flag, or the
    // second document opened in a session would never be measured. That is
    // exactly the case the stall shows up in.
    if (stage === 'first-page' && performance.getEntriesByName(PREFIX + stage).length > 0) return
    performance.mark(PREFIX + stage)
    if (stage === 'first-page') reportIfRequested()
  } catch {
    // performance is unavailable in some embedding contexts; timing is never
    // worth breaking a document open over.
  }
}

/** Clear the previous document's marks so a second open is measured on its own. */
export function resetOpenMarks(): void {
  try {
    for (const mark of performance.getEntriesByType('mark')) {
      if (mark.name.startsWith(PREFIX)) performance.clearMarks(mark.name)
    }
  } catch { /* see above */ }
}

/** Elapsed milliseconds for each stage, relative to navigation start. */
export function openTimings(): Record<string, number> {
  const out: Record<string, number> = {}
  try {
    for (const mark of performance.getEntriesByType('mark')) {
      if (mark.name.startsWith(PREFIX)) {
        out[mark.name.slice(PREFIX.length)] = Math.round(mark.startTime)
      }
    }
  } catch { /* see above */ }
  return out
}

function reportIfRequested(): void {
  try {
    if (!new URLSearchParams(window.location.search).has('perf')) return
    const t = openTimings()
    console.info(
      `[wz-perf] bytes=${t.bytes ?? '?'}ms engine=${t.engine ?? '?'}ms ` +
      `document=${t.document ?? '?'}ms first-page=${t['first-page'] ?? '?'}ms`,
    )
  } catch { /* see above */ }
}
