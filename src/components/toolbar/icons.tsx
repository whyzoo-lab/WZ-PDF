// Toolbar SVG icon components — pure, presentational, no props.
// Extracted from ActionBar.tsx so the toolbar layout logic stays readable.
//
// ── One system, one set of rules ────────────────────────────────────────────
// Every icon below follows the SAME spec so the bar reads as one family:
//   * viewBox   24×24        (was a mix of 20×20 and 24×24 — different optical
//                             weights at the same rendered size)
//   * stroke    1.8, currentColor, fill="none"
//               (was a mix of 1.5 / 1.7 / 1.8 / 2, and several icons declared
//                fill="currentColor" on <svg> then fill="none" on every child)
//   * caps      round cap + round join everywhere
//   * size      w-4 h-4, set once in ICON_CLS
// Solid fills are used only where a shape is genuinely solid (the select arrow,
// the "more" dots). Keep new icons on this spec — mixing weights is what made
// the old set look noisy.

const ICON_CLS = 'w-4 h-4'

/** Shared wrapper: fixes viewBox, stroke weight and line joins in one place. */
function Icon({ children, className = ICON_CLS }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

// ── View modes ──────────────────────────────────────────────────────────────
export const IconSingle = () => (
  <Icon><rect x="7" y="3" width="10" height="18" rx="1.5" /></Icon>
)
export const IconSpread = () => (
  <Icon>
    <rect x="2.5" y="4" width="8.5" height="16" rx="1.5" />
    <rect x="13" y="4" width="8.5" height="16" rx="1.5" />
  </Icon>
)
export const IconGrid = () => (
  <Icon>
    <rect x="3" y="3" width="7.5" height="8.5" rx="1.2" />
    <rect x="13.5" y="3" width="7.5" height="8.5" rx="1.2" />
    <rect x="3" y="12.5" width="7.5" height="8.5" rx="1.2" />
    <rect x="13.5" y="12.5" width="7.5" height="8.5" rx="1.2" />
  </Icon>
)
export const IconFullscreen = () => (
  <Icon><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></Icon>
)
export const IconRotate = () => (
  <Icon>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <path d="M20 3v4.5h-4.5" />
  </Icon>
)

// ── Zoom ────────────────────────────────────────────────────────────────────
export const IconZoomOut = () => (
  <Icon><circle cx="10.5" cy="10.5" r="6.5" /><path d="M7.5 10.5h6M20 20l-4.4-4.4" /></Icon>
)
export const IconZoomIn = () => (
  <Icon><circle cx="10.5" cy="10.5" r="6.5" /><path d="M10.5 7.5v6M7.5 10.5h6M20 20l-4.4-4.4" /></Icon>
)

// ── Editor tools ────────────────────────────────────────────────────────────
export const IconSelect = () => (
  // Solid on purpose: a cursor arrow reads wrong as an outline.
  <Icon><path d="M5 3l14 9-6.2 1.6L10 20 5 3z" fill="currentColor" stroke="none" /></Icon>
)
export const IconStamp = () => (
  <Icon>
    <path d="M9 10V7a3 3 0 1 1 6 0v3" />
    <path d="M7 10h10l-.7 4H7.7L7 10z" />
    <rect x="5" y="16.5" width="14" height="3.5" rx="1.2" />
  </Icon>
)
export const IconSignature = () => (
  <Icon>
    <path d="M3 16c2.5-5 4.5-9.5 5.6-11.4.6-1.1 2.3-.9 2.3.4 0 2.2-1.4 4.3-1.4 6.4 0 2.4 3.4-1.6 4.8-2.7" />
    <path d="M3 20h18" />
  </Icon>
)
export const IconWatermark = () => (
  // Diagonal repeated strokes over a page — no SVG <text> glyph (the old "W"
  // rendered at the mercy of the system font and looked different everywhere).
  <Icon>
    <rect x="3.5" y="3" width="17" height="18" rx="1.8" />
    <path d="M7 15.5l4-6M11.5 15.5l4-6" opacity="0.9" />
  </Icon>
)
export const IconDelete = () => (
  <Icon>
    <path d="M4 6.5h16" />
    <path d="M9.5 6.5V4.5h5v2" />
    <path d="M6.5 6.5l.9 13a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.9-13" />
    <path d="M10.5 10.5v6M13.5 10.5v6" />
  </Icon>
)
export const IconReset = () => (
  // Eraser — deliberately distinct from the rotate/undo arcs.
  <Icon>
    <path d="M9.5 19.5l-4.6-4.6a1.6 1.6 0 0 1 0-2.3l7.3-7.3a1.6 1.6 0 0 1 2.3 0l4.2 4.2a1.6 1.6 0 0 1 0 2.3L13.5 19.5H9.5z" />
    <path d="M20 19.5h-8" />
    <path d="M7.2 10.6l6.2 6.2" />
  </Icon>
)

// ── File / export ───────────────────────────────────────────────────────────
export const IconUpload = () => (
  <Icon><path d="M12 15.5V4.5M8 8l4-3.5L16 8" /><path d="M4.5 19.5h15" /></Icon>
)
export const IconDownload = () => (
  <Icon><path d="M12 4.5v11M8 12l4 3.5 4-3.5" /><path d="M4.5 19.5h15" /></Icon>
)
export const IconLink = () => (
  <Icon>
    <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
    <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
  </Icon>
)
export const IconHtml = () => (
  <Icon><path d="M8 8l-4 4 4 4M16 8l4 4-4 4" /><path d="M13.5 5l-3 14" /></Icon>
)
export const IconImage = () => (
  <Icon>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="M3.5 17l5-5 3.5 3.5 3-3 5.5 5" />
  </Icon>
)
export const IconExe = () => (
  // App window + a small gear-free "run" chevron; the old version stacked a
  // filled circle and a white cross, which muddied at 16px.
  <Icon>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="M3 9h18" />
    <path d="M10 12.5l3 2.5-3 2.5" />
  </Icon>
)
export const IconPrint = () => (
  <Icon>
    <path d="M7 9V4h10v5" />
    <path d="M7 17.5H5.5A1.5 1.5 0 0 1 4 16v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1.5 1.5 0 0 1-1.5 1.5H17" />
    <rect x="7" y="14" width="10" height="6" rx="1" />
  </Icon>
)
/** Recognize text — a document inside a scan frame.
 *
 *  The frame's corners are deliberately square while the printer beside it is
 *  all rounded: at 16px the two used to differ only in their innards, and the
 *  silhouette is what the eye actually sorts by. */
export const IconOcr = () => (
  <Icon>
    <path d="M3 7.5V3h4.5M16.5 3H21v4.5M21 16.5V21h-4.5M7.5 21H3v-4.5" />
    <path d="M7.5 5.5h6l4 4v9h-10z" />
    <path d="M13.5 5.5v4h4" />
    <path d="M10 13h5M10 16h5" />
  </Icon>
)

// ── Modes ───────────────────────────────────────────────────────────────────
/** Closed padlock — viewer mode (document is locked / read-only). */
export const IconLock = () => (
  <Icon>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </Icon>
)
/** Open padlock — editor mode (editing unlocked). The shackle swings right, so
 *  the two states differ in silhouette, not just in colour. */
export const IconLockOpen = () => (
  <Icon>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 7.8-1.2" />
  </Icon>
)

export const IconViewer = () => (
  <Icon>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)
export const IconEditor = () => (
  <Icon>
    <path d="M16.5 3.5l4 4L9 19H5v-4L16.5 3.5z" />
    <path d="M14 6l4 4" />
  </Icon>
)

// ── Chrome ──────────────────────────────────────────────────────────────────
export const IconChevron = () => (
  <Icon className="w-3 h-3"><path d="M6 9l6 6 6-6" /></Icon>
)
/** Hamburger — collapsed left cluster. */
export const IconMenu = () => (
  <Icon className="w-5 h-5"><path d="M4 6h16M4 12h16M4 18h16" /></Icon>
)
/** Vertical dots — collapsed right (actions) cluster. */
export const IconMore = () => (
  <Icon className="w-5 h-5">
    <circle cx="12" cy="5" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.7" fill="currentColor" stroke="none" />
  </Icon>
)

/** Fit the page width — arrows pushing out to both edges of a page. */
export const IconFitWidth = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4">
    <rect x="4" y="3" width="12" height="14" rx="1" />
    <path d="M7 10h6M7 10l2-2M7 10l2 2M13 10l-2-2M13 10l-2 2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Read aloud — a speaker with sound waves. */
export const IconSpeak = () => (
  <Icon>
    <path d="M4.5 9.5v5h3l4.5 3.5V6l-4.5 3.5h-3z" />
    <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.4a8 8 0 0 1 0 11.2" />
  </Icon>
)

/** Stop reading — a filled square, the universal stop. */
export const IconStopSpeak = () => (
  <Icon>
    <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" />
  </Icon>
)
