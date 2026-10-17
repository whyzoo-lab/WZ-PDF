export type AnnotationType =
  | 'stamp' | 'signature' | 'watermark' | 'pen' | 'rectangle' | 'textEdit'
  | 'highlight' | 'underline' | 'strikeout' | 'note'
  | 'formValue' | 'fill' | 'redact'

export interface BaseAnnotation {
  id: string
  page: number        // 1-based page number
  type: AnnotationType
  x: number          // PDF points (screen pixels / effectiveZoom, where effectiveZoom = PDF_RENDER_SCALE * zoom)
  y: number          // PDF points (screen pixels / effectiveZoom, where effectiveZoom = PDF_RENDER_SCALE * zoom)
  width: number      // PDF points (screen pixels / effectiveZoom, where effectiveZoom = PDF_RENDER_SCALE * zoom)
  height: number     // PDF points (screen pixels / effectiveZoom, where effectiveZoom = PDF_RENDER_SCALE * zoom)
  rotation: number   // degrees
}

export interface StampAnnotation extends BaseAnnotation {
  type: 'stamp'
  src: string        // base64 PNG
  presetId?: string  // 'approved' | 'rejected' | 'confidential' | 'draft' | undefined
}

export interface SignatureAnnotation extends BaseAnnotation {
  type: 'signature'
  src: string        // base64 PNG from handwriting canvas
}

export interface WatermarkAnnotation extends BaseAnnotation {
  type: 'watermark'
  text: string
  opacity: number    // 0–1
  fontSize: number   // in PDF points (applied at renderScale in display)
  color: string      // hex color e.g. '#888888'
  allPages: boolean  // when true, page field is ignored
}

/**
 * Free-form highlighter / pen stroke. Volatile — not exported to PDF, cleared
 * by ESC or the Reset button. x/y/width/height fields are unused; the stroke
 * is fully described by `points`.
 */
export interface PenAnnotation extends BaseAnnotation {
  type: 'pen'
  points: number[]   // flat [x1, y1, x2, y2, ...] in PDF points, page-local
  color: string      // hex color e.g. '#FFFF00'
  strokeWidth: number // PDF points
  opacity: number    // 0–1
}

/**
 * Drag-to-create rectangle outline. Volatile — same semantics as PenAnnotation.
 * x/y/width/height represent the rectangle in PDF points.
 */
export interface RectangleAnnotation extends BaseAnnotation {
  type: 'rectangle'
  color: string       // hex color e.g. '#FF0000'
  strokeWidth: number // PDF points
}

/**
 * Editor-mode text patch: covers the original PDF text at (x, y, width, height)
 * with a white rectangle and renders `text` on top in the default font.
 * Created by double-clicking a text span in the selectable text layer.
 */
export interface TextEditAnnotation extends BaseAnnotation {
  type: 'textEdit'
  text: string       // new text content to display
  fontSize: number   // PDF points (matches original text size)
  color: string      // hex color, default '#000000'
  background: string // rectangle fill that hides the original, default '#FFFFFF'
}

/** One answer in a comment's thread. */
export interface CommentReply {
  id: string
  author: string
  contents: string
  /** ms since the epoch */
  createdAt: number
}

/**
 * What makes an annotation a comment: what it says, who said it, the answers
 * and whether it has been dealt with. Saved as a real PDF annotation —
 * /Contents, /T, /M, replies as /IRT annotations, "done" as a /State reply —
 * so Acrobat, Edge and pdf.js list it as a comment.
 */
export interface CommentFields {
  contents: string
  author: string
  createdAt: number
  modifiedAt?: number
  replies: CommentReply[]
  done?: boolean
  /**
   * Set on a comment read from the file (services/pdfCommentImport): who it
   * is across reloads of the same document, so a page edit, which reloads
   * it, does not import it a second time.
   */
  importKey?: string
}

/** A rectangle in PDF points, top-left origin — one line of marked text. */
export interface MarkupRect { x: number; y: number; width: number; height: number }

/**
 * Highlight, underline or strike-through over text the reader selected.
 * `rects` is one box per line (x/y/width/height is their union), in the
 * page's own unrotated space — saved as /QuadPoints.
 */
export interface TextMarkupAnnotation extends BaseAnnotation, CommentFields {
  type: 'highlight' | 'underline' | 'strikeout'
  rects: MarkupRect[]
  color: string
  /** The text that was selected, for the comments list. */
  text: string
}

/** A sticky note: an icon at x/y (width/height = icon size), and its comment. */
export interface NoteAnnotation extends BaseAnnotation, CommentFields {
  type: 'note'
  color: string
}

/** A form field's value: text, a check box's state, the chosen radio / list option(s). */
export type FormValue = string | boolean | string[]

/**
 * What the reader filled into a form field (services/pdfForms), one per field
 * name. Not drawn as a mark: the field's control shows it. Kept as an
 * annotation so undo, "unsaved", autosave and the EXE treat it like any edit.
 * `page` is the page of the field's first widget; x/y/width/height are unused.
 */
export interface FormValueAnnotation extends BaseAnnotation {
  type: 'formValue'
  fieldName: string
  value: FormValue
}

/** What Fill & Sign puts on a page: typed text (a date is text), or a mark. */
export type FillMark = 'text' | 'check' | 'cross' | 'dot' | 'line'

/**
 * Fill & Sign: typed text or a ✓ ✕ ● ─ mark placed anywhere — for a form that
 * has no fields, as Acrobat's Fill & Sign does. x/y/width/height is its box in
 * PDF points; saved into the page content (drawn, like a stamp).
 */
export interface FillAnnotation extends BaseAnnotation {
  type: 'fill'
  mark: FillMark
  /** For `text`. */
  text: string
  /** For `text`: PDF points. */
  fontSize: number
  color: string
}

/**
 * An area marked for redaction, waiting to be applied (services/redact):
 * once applied, what lies under it is gone from the file, not covered.
 * `rects` in viewport points, like a highlight's; x/y/width/height their union.
 * Never saved as it is — a PDF with marks still pending is not saved.
 */
export interface RedactAnnotation extends BaseAnnotation {
  type: 'redact'
  rects: MarkupRect[]
  /** The words it was made over, if any (for the list). */
  text: string
}

export type Annotation =
  | StampAnnotation
  | SignatureAnnotation
  | WatermarkAnnotation
  | PenAnnotation
  | RectangleAnnotation
  | TextEditAnnotation
  | TextMarkupAnnotation
  | NoteAnnotation
  | FormValueAnnotation
  | FillAnnotation
  | RedactAnnotation

export type CommentAnnotation = TextMarkupAnnotation | NoteAnnotation
export type TextMarkupType = TextMarkupAnnotation['type']

export const TEXT_MARKUP_TYPES: readonly TextMarkupType[] = ['highlight', 'underline', 'strikeout']

export function isTextMarkup(a: Pick<Annotation, 'type'>): a is TextMarkupAnnotation {
  return (TEXT_MARKUP_TYPES as readonly string[]).includes(a.type)
}

/** Highlights, underlines, strike-throughs and notes — what the comments panel lists. */
export function isComment(a: Pick<Annotation, 'type'>): a is CommentAnnotation {
  return a.type === 'note' || isTextMarkup(a)
}

/** The colour each tool starts with (Acrobat's defaults, near enough). */
export const MARKUP_COLORS: Record<TextMarkupType | 'note', string> = {
  highlight: '#FFE14D',
  underline: '#1E88E5',
  strikeout: '#E53935',
  note: '#FFC21A',
}

/** Swatches offered for a comment's colour. */
export const COMMENT_SWATCHES = ['#FFE14D', '#7EE07E', '#7CC8FF', '#FF9ECF', '#FFB74D', '#1E88E5', '#E53935'] as const

/** Note icon size, PDF points. */
export const NOTE_SIZE = 20

// Distributive Omit over the Annotation union. `T extends unknown` triggers
// distribution just like `extends any` but without the no-explicit-any lint.
export type OmitId<T> = T extends unknown ? Omit<T, 'id'> : never

/**
 * The stamp the next click places. It carries its size so a stamp comes out
 * the size it was last given (see services/stampLibrary) and stays armed for
 * the next click — stamping several pages is click, click, click.
 */
export interface PendingStamp {
  src: string
  /** Preset id, or `custom:<id>` for an uploaded stamp. */
  presetId?: string
  /** PDF points. */
  width: number
  height: number
}

export type ActiveMode =
  | 'select' | 'stamp' | 'signature' | 'watermark' | 'pen' | 'rectangle'
  | 'highlight' | 'underline' | 'strikeout' | 'note'
  | 'fill'
  | 'redact' | 'redactArea' | 'signArea'
  | null

/** Tools that mark text the reader selects. */
export function isMarkupMode(mode: ActiveMode): mode is TextMarkupType {
  return mode === 'highlight' || mode === 'underline' || mode === 'strikeout'
}

/** Annotation types that are display-only (not exported to PDF, cleared by Reset). */
export const VOLATILE_TYPES: readonly AnnotationType[] = ['pen', 'rectangle']

/** Accepts anything with a type, so a not-yet-saved annotation (no id) qualifies. */
export function isVolatile(a: Pick<Annotation, "type">): boolean {
  return VOLATILE_TYPES.includes(a.type)
}

/**
 * Annotations that belong on a given 1-based page. `allPages` watermarks match
 * every page; everything else matches only its own `page`. Single source of
 * truth used by the renderer, the print pipeline, and the PDF exporter.
 */
export function annotationsForPage(annotations: Annotation[], pageNumber: number): Annotation[] {
  return annotations.filter(a =>
    a.type === 'watermark' ? a.allPages || a.page === pageNumber : a.page === pageNumber,
  )
}
