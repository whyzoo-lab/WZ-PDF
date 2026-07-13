// Toolbar SVG icon components — pure, presentational, no props.
// Extracted from ActionBar.tsx so the toolbar layout logic stays readable.

export const IconSingle = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <rect x="5" y="3" width="10" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
  </svg>
)
export const IconSpread = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <rect x="1" y="3" width="8" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <rect x="11" y="3" width="8" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
  </svg>
)
export const IconGrid = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <rect x="2" y="2" width="6" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <rect x="12" y="2" width="6" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <rect x="2" y="11" width="6" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <rect x="12" y="11" width="6" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
  </svg>
)
export const IconFullscreen = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/>
  </svg>
)
export const IconRotate = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M4 10a6 6 0 0 1 10.5-4H12" strokeLinecap="round"/>
    <path d="M14.5 6l1.5-2.5L13.5 2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M16 10a6 6 0 0 1-10.5 4H8" strokeLinecap="round"/>
    <path d="M5.5 14l-1.5 2.5L6.5 18" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
export const IconZoomOut = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
    <circle cx="9" cy="9" r="6"/>
    <path d="M6.5 9h5M15 15l2.5 2.5" strokeLinecap="round"/>
  </svg>
)
export const IconZoomIn = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
    <circle cx="9" cy="9" r="6"/>
    <path d="M9 6.5v5M6.5 9h5M15 15l2.5 2.5" strokeLinecap="round"/>
  </svg>
)
export const IconSelect = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path d="M4 2l12 8-6.5 1.5L7 18 4 2z"/>
  </svg>
)
export const IconStamp = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <rect x="4" y="13" width="12" height="4" rx="1"/>
    <path d="M7 13V8a3 3 0 0 1 6 0v5"/>
  </svg>
)
export const IconSignature = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M3 15c2-4 4-8 5-10 .5-1 2-1 2 0s-1 3-1 5c0 2 3-2 4-3" strokeLinecap="round"/>
    <path d="M3 17h14" strokeLinecap="round"/>
  </svg>
)
export const IconWatermark = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4" opacity="0.85">
    <rect x="2" y="2" width="16" height="16" rx="1"/>
    <text x="5" y="14" fontSize="9" fill="currentColor" stroke="none" opacity="0.7" fontWeight="bold">W</text>
  </svg>
)
export const IconDelete = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M5 6h10l-1 11H6L5 6zM3 6h14M8 6V4h4v2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
export const IconUpload = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M10 13V5M7 8l3-3 3 3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4 15h12" strokeLinecap="round"/>
  </svg>
)
export const IconLink = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M8 11a3 3 0 004.24 0l2.5-2.5a3 3 0 00-4.24-4.24L11 5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 9a3 3 0 00-4.24 0l-2.5 2.5a3 3 0 004.24 4.24L9 15" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
export const IconDownload = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M10 5v8M7 10l3 3 3-3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4 15h12" strokeLinecap="round"/>
  </svg>
)
export const IconHtml = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M5 7l-3 3 3 3M15 7l3 3-3 3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 4l-4 12" strokeLinecap="round"/>
  </svg>
)
export const IconImage = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <rect x="2" y="4" width="16" height="12" rx="1.5"/>
    <circle cx="7" cy="8.5" r="1.5"/>
    <path d="M2 14l4-4 3 3 3-3 6 5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
export const IconChevron = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
    <path d="M5 7l5 5 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
export const IconPrint = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <rect x="4" y="8" width="12" height="8" rx="1"/>
    <path d="M6 8V4h8v4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M6 12h8M6 14.5h5" strokeLinecap="round"/>
    <circle cx="15" cy="11" r="0.8" fill="currentColor" stroke="none"/>
  </svg>
)
export const IconOcr = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M7 8h6M7 12h10M7 16h8" />
  </svg>
)
// Eraser — distinct from the (similar-looking) view/rotate icons.
export const IconReset = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="w-4 h-4">
    <path d="M8.5 16.5l-3.8-3.8a1.5 1.5 0 0 1 0-2.12l6-6a1.5 1.5 0 0 1 2.12 0l3.3 3.3a1.5 1.5 0 0 1 0 2.12L11.5 16.5H8.5z" strokeLinejoin="round"/>
    <path d="M16.5 16.5H8.5" strokeLinecap="round"/>
    <path d="M6.2 8.8l5 5" />
  </svg>
)
export const IconExe = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <rect x="3" y="4" width="14" height="12" rx="1.5"/>
    <path d="M7 8h6M7 10.5h4" strokeLinecap="round"/>
    <path d="M13 13l2 2" strokeLinecap="round"/>
    <circle cx="14.5" cy="14.5" r="2.5" fill="currentColor" stroke="none" opacity="0.9"/>
    <path d="M13.8 14.5h1.4M14.5 13.8v1.4" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
)
export const IconViewer = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M10 4C5 4 2 10 2 10s3 6 8 6 8-6 8-6-3-6-8-6z"/>
    <circle cx="10" cy="10" r="2.5"/>
  </svg>
)
export const IconEditor = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <path d="M14 3l3 3-9 9H5v-3L14 3z" strokeLinejoin="round"/>
  </svg>
)
// Hamburger — collapsed left cluster.
export const IconMenu = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
    <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round"/>
  </svg>
)
// Vertical dots — collapsed right (actions) cluster.
export const IconMore = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
    <circle cx="10" cy="4" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="10" cy="16" r="1.6"/>
  </svg>
)
