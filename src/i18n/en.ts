/** English messages (default / fallback). Keys are shared across all locales. */
export const en = {
  // ── Branding / empty state ────────────────────────────────────────────────
  'app.tagline': 'Fast and simple PDF',
  'empty.desktop': 'Drag a PDF here, or click Open / press F2',
  'empty.mobile': 'Tap or use the Open button to open a PDF',

  // ── Toolbar tooltips (title / aria-label) ─────────────────────────────────
  'tool.single': 'Single page',
  'tool.spread': 'Spread (2 pages)',
  'tool.grid': 'Grid view',
  'tool.fullscreen': 'Fullscreen (F5)',
  'tool.zoomOut': 'Zoom out',
  'tool.zoomReset': 'Reset zoom',
  'tool.zoomIn': 'Zoom in',
  'tool.rotate': 'Rotate 90° (current: {deg}°)',
  'tool.pages': 'Toggle page panel',
  'tool.reset': 'Clear markups (pen / rectangle)',
  'tool.select': 'Select',
  'tool.stamp': 'Stamp',
  'tool.signature': 'Signature',
  'tool.watermark': 'Watermark',
  'tool.delete': 'Delete selected',
  'tool.viewer': 'Viewer mode — read only',
  'tool.editor': 'Editor mode — stamp / sign / watermark',
  'tool.open': 'Open PDF (F2)',
  'tool.print': 'Print (Ctrl+P)',
  'tool.export': 'Export',
  'tool.exporting': 'Exporting…',

  // ── Stamp menu ────────────────────────────────────────────────────────────
  'stamp.uploadImage': 'Upload image…',

  // ── Export menu ───────────────────────────────────────────────────────────
  'export.pdf': 'Save PDF',
  'export.html': 'Save HTML',
  'export.images': 'Save Images',
  'export.exe': 'EXE Viewer',
  'export.pdfDone': 'PDF saved — {name}',
  'export.htmlDone': 'HTML saved — {name}',
  'export.imagesDone': 'Images saved — {name}',
  'export.exeDone': 'EXE Viewer saved',
  'export.imagesFailed': 'Image export failed: {error}',
  'export.exeFailed': 'EXE export failed\n\n{error}',
  'export.exeError': 'EXE export error: {error}',
  'export.exeUnknownError': 'Unknown error',
  'export.exeWebPrompt':
    'EXE Viewer is a desktop-app feature.\n\nDownload the WZ PDF installer?',

  // ── Print ─────────────────────────────────────────────────────────────────
  'print.preparing': 'Preparing to print…',
  'print.progress': '{done} / {total} pages',

  // ── Upload / file errors ──────────────────────────────────────────────────
  'error.pdfOnly': 'Only PDF files can be opened.',
  'error.openFailed': 'Could not open the file: {error}',
  'error.pdfInsertFailed': 'Could not insert the PDF: {error}',

  // ── Page panel ────────────────────────────────────────────────────────────
  'panel.title': 'Pages',
  'panel.close': 'Close panel',
  'panel.add': '+ Add ▾',
  'panel.addTitle': 'Add page',
  'panel.insertBlank': 'Insert blank page',
  'panel.insertFromPdf': 'Insert from another PDF…',
  'panel.deleteN': 'Delete {n} page(s)',
  'panel.selectFirst': 'Select pages first',
  'panel.confirmDelete': 'Delete the selected {n} page(s)?',
  'panel.readError': 'Could not read the PDF: {error}',
  'panel.processing': 'Processing…',

  // ── Open from URL ─────────────────────────────────────────────────────────
  'url.title': 'Open PDF from URL',
  'url.hint': 'Paste a direct link to a PDF file.',
  'url.load': 'Load',
  'url.loading': 'Loading…',
  'url.cancel': 'Cancel',
  'url.invalid': 'Please enter a valid http(s) URL.',
  'url.loadFailed': 'Could not load the PDF: {error}',
  'url.corsBlocked': "Could not load the PDF — the host blocks cross-origin requests (CORS). Try downloading the file and opening it directly, or use the desktop app.",
  'tool.openFile': 'Open file…',
  'tool.openUrl': 'Open from URL…',

  // ── OCR ───────────────────────────────────────────────────────────────────
  'ocr.runCurrent': 'OCR (current page)',
  'ocr.runAll': 'OCR (whole document)',
  'ocr.progress': 'OCR {done}/{total}',
  'ocr.noText': 'No text recognized',
  'ocr.engineError': 'OCR engine failed to load',
  'ocr.cancel': 'Cancel OCR',
  'ocr.recognizing': 'Recognizing…',

  // ── Update notice ─────────────────────────────────────────────────────────
  'update.available': 'New version {version} available',
  'update.download': 'Download the latest',
  'update.dismiss': 'Dismiss',

  // ── Search (Ctrl+F) ───────────────────────────────────────────────────────
  'search.placeholder': 'Find in document',
  'search.noResults': 'No results',
  'search.next': 'Next match (Enter)',
  'search.prev': 'Previous match (Shift+Enter)',
  'search.close': 'Close (Esc)',

  // ── Error boundary ────────────────────────────────────────────────────────
  'errorBoundary.title': 'Something went wrong',
  'errorBoundary.body': 'The viewer hit an unexpected error. Reloading usually fixes it.',
  'errorBoundary.reload': 'Reload',

  // ── Presenter tools (fullscreen ZoomIt-style HUD) ─────────────────────────
  'present.pen': 'Pen',
  'present.highlighter': 'Highlighter',
  'present.rect': 'Rectangle',
  'present.arrow': 'Arrow',
  'present.laser': 'Laser',
  'present.zoom': 'Spotlight zoom',
} as const
