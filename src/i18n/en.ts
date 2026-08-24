/** English messages (default / fallback). Keys are shared across all locales. */
export const en = {
  // ── Branding / empty state ────────────────────────────────────────────────
  'app.tagline': 'Fast and simple PDF',
  'empty.desktop': 'Drag a PDF · HWP · EML · image · Markdown here, or click Open / press F2',
  'empty.mobile': 'Tap or use the Open button to open a PDF · HWP · EML · image · Markdown',

  // ── Toolbar tooltips (title / aria-label) ─────────────────────────────────
  'tool.single': 'Single page',
  'tool.spread': 'Spread (2 pages)',
  'tool.grid': 'Grid view',
  'tool.fullscreen': 'Fullscreen (F5)',
  'tool.zoomOut': 'Zoom out',
  'tool.fitWidth': 'Fit width — sharper text, but the page scrolls',
  'tool.zoomReset': 'Reset zoom',
  'tool.zoomIn': 'Zoom in',
  'tool.rotate': 'Rotate right 90° (now {deg}°)',
  'tool.rotateLeft': 'Rotate left 90° (now {deg}°)',
  'tool.pages': 'Toggle page panel',
  'tool.reset': 'Clear markups (pen / rectangle)',
  'tool.select': 'Select',
  'tool.stamp': 'Stamp',
  'tool.signature': 'Signature',
  'tool.watermark': 'Watermark',
  'tool.delete': 'Delete selected',
  'tool.viewer': 'Viewer mode — read only',
  'tool.editor': 'Editor mode — stamp / sign / watermark',
  'tool.editTools': 'Edit',
  // Short labels shown inside the viewer/editor segmented switch.
  // Accessible label for the edit-lock switch (locked = read-only viewer).
  'tool.editLock': 'Edit',
  'tool.passwordSet': 'Set a password',
  'tool.passwordRemove': 'Remove the password',
  'tool.open': 'Open PDF (F2)',
  'tool.print': 'Print (Ctrl+P)',
  'tool.export': 'Export',
  'tool.exporting': 'Exporting…',
  'tool.exportPdf': 'Download PDF',
  'tool.exportMore': 'Other formats',
  'tool.zoomLevel': 'Zoom level (%)',
  'tool.menuLeft': 'View & tools',
  'tool.menuRight': 'Actions',

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
  'export.htmlFailed': 'HTML export failed: {error}',
  'export.exeFailed': 'EXE export failed\n\n{error}',
  'export.exeError': 'EXE export error: {error}',
  'export.exeUnknownError': 'Unknown error',
  'export.exeWebPrompt':
    'EXE Viewer is a desktop-app feature.\n\nDownload the WZ PDF installer?',

  // ── Print ─────────────────────────────────────────────────────────────────
  'print.preparing': 'Preparing to print…',
  'print.progress': '{done} / {total} pages',
  'print.previewTitle': 'Print preview',
  'print.previewHint': 'Shows exactly what will print — stamps, signatures and watermarks included',
  'print.pageCount': '{total} pages',
  'print.doPrint': 'Print',
  'print.cancel': 'Cancel',

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
  'panel.saveSelected': 'Save selection ({n})',
  'panel.savedSelected': '{n} page(s) saved',

  // ── Encrypted documents ──
  'password.title': 'This document is protected',
  'password.body': 'Enter the password to open it.',
  'password.wrong': 'That password did not work. Try again.',
  'password.label': 'Password',
  'password.open': 'Open',
  'password.cancel': 'Cancel',
  'password.required': 'A password is needed to open this document.',
  'password.willApply': 'The next save will put this password on the file.',
  'password.willRemove': 'The next save will leave the file unlocked.',
  'pdf.encryptedNoEdit': 'Page editing and saving are not available for a password-protected document.',
  'encrypt.title': 'Save with a password',
  'encrypt.body': 'The saved PDF will need this password to open.',
  'encrypt.label': 'Password',
  'encrypt.confirmLabel': 'Confirm password',
  'encrypt.mismatch': 'The two passwords do not match.',
  'encrypt.warning': 'There is no way to recover it — a lost password means a file nobody can open.',
  'encrypt.save': 'Save',
  'export.pdfLockedDone': 'Saved {name} with a password.',
  'export.pdfUnlockedDone': 'Saved {name} with its password removed.',
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

  // ── HWP ───────────────────────────────────────────────────────────────────
  'hwp.engineError': 'HWP engine failed to load',
  'hwp.badge': 'HWP',

  // ── Region OCR (Ctrl+drag → copy) ─────────────────────────────────────────
  'region.recognizing': 'Recognizing…',
  'region.copied': 'Copied text to clipboard',
  'region.noText': 'No text recognized',
  'region.copyFailed': 'Copy to clipboard failed',

  // ── OCR ───────────────────────────────────────────────────────────────────
  'ocr.runCurrent': 'OCR (current page)',
  'ocr.runAll': 'OCR (whole document)',
  'ocr.progress': 'OCR {done}/{total}',
  'ocr.noText': 'No text recognized',
  'ocr.engineError': 'OCR engine failed to load',
  'ocr.cancel': 'Cancel OCR',

  // ── Read aloud ───────────────────────────────────────────────────────────
  'tts.read': 'Read aloud',
  'tts.stop': 'Stop reading',
  'tts.pause': 'Pause',
  'tts.resume': 'Resume',
  'tts.preparing': 'Preparing speech...',
  'tts.reading': 'Reading {done}/{total}',
  'tts.noText': 'Nothing to read on this page',
  'tts.needsOcr': 'No text on this page. Run OCR first, then press read aloud.',
  'tts.needsModel': 'Reading aloud needs a one-time {size} download of the voice model. It then works offline.',
  'tts.download': 'Download voice model',
  'tts.downloading': 'Downloading voice model {done}/{total} MB',
  'tts.cancel': 'Cancel',
  'tts.voice': 'Voice',
  'tts.speed': 'Speed',
  'tts.apply': 'Apply',
  'tts.applying': 'Applying...',
  'tts.desktopOnly': 'Reading aloud is available in the desktop app',
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
  // ── Email (.eml) ──────────────────────────────────────────────────────────
  'email.from': 'From',
  'email.to': 'To',
  'email.cc': 'Cc',
  'email.date': 'Date',
  'email.noSubject': '(no subject)',
  'email.noBody': 'This message has no displayable body.',
  'email.attachments': 'Attachments',
  'email.download': 'Download',
  'email.openHere': 'Open here',
  'email.imagesBlocked': 'Blocked {n} remote image(s) — loading them tells the sender you opened this.',
  'email.loadImages': 'Load images',
  // ── Markdown (.md) ────────────────────────────────────────────────────────
  'md.contents': 'Contents',
  'md.renderFailed': 'This Markdown document could not be displayed.',
  'md.source': 'Source (Markdown)',
  'md.save': 'Save',
  'md.saved': 'Saved — {name}',
  'md.unsaved': 'Edited',
  'md.editHint': 'Unlock editing to change the source directly.',
} as const
