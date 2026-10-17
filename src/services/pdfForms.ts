// PDF forms (AcroForm): the fields a page has, filled in over the page and
// saved into the file. After PdfCraft's `crates/forms` (Apache-2.0/MIT).
//
// On screen a field is an HTML control over the page (components/forms/
// FormLayer); its drawing in the page picture is hidden (`noView`, as for
// comments — see pdfCommentImport) so the old value does not show beneath.
// For printing, pdf.js draws the fields itself from the values put in its
// annotation storage (`applyFormStorage`) — Korean included, through its
// FakeUnicodeFont. Saving goes through pdf-lib's form API (pdfFormFill.ts,
// kept apart so pdf-lib stays out of the viewer's chunk).
//
// What the reader typed is kept as `formValue` annotations, one per field
// name: undo, "unsaved", autosave and the EXE then work as for any mark.

import type { ViewerDoc } from '../types/viewerDoc'
import type { Annotation, FormValue, FormValueAnnotation, MarkupRect } from '../types/annotation'

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'choice'

/** One widget of a fillable field, in viewport points (the page as pdf.js shows it at scale 1). */
export interface FormWidget {
  id: string
  page: number
  name: string
  kind: FieldKind
  rect: MarkupRect
  /** What a screen reader calls it: the field's tooltip (/TU), else its name. */
  label: string
  /** The value in the file. */
  value: FormValue
  /** A check box's or radio button's "on" value. */
  onValue?: string
  options?: { value: string; label: string }[]
  multiLine?: boolean
  combo?: boolean
  multiSelect?: boolean
  readOnly?: boolean
  maxLen?: number
  password?: boolean
  /** From the field's /DA; 0 = fit to the box. */
  fontSize: number
  /** 0 left, 1 centre, 2 right. */
  align: number
}

interface RawWidget {
  id: string
  subtype: string
  fieldType?: string | null
  fieldName?: string
  fieldValue?: unknown
  rect: number[]
  checkBox?: boolean
  radioButton?: boolean
  pushButton?: boolean
  exportValue?: string
  buttonValue?: string | null
  options?: { exportValue: string; displayValue: string }[]
  combo?: boolean
  multiSelect?: boolean
  multiLine?: boolean
  readOnly?: boolean
  maxLen?: number
  password?: boolean
  hidden?: boolean
  alternativeText?: string
  textAlignment?: number | null
  defaultAppearanceData?: { fontSize?: number } | null
}

interface PdfjsPage {
  getAnnotations(params?: { intent?: string }): Promise<RawWidget[]>
  getViewport(params: { scale: number }): { convertToViewportPoint(x: number, y: number): number[] }
}

/** Whether a widget is a field the reader fills in (not a push button or signature). */
export function isFillableWidget(a: { subtype: string; fieldType?: string | null; pushButton?: boolean; hidden?: boolean }): boolean {
  if (a.subtype !== 'Widget' || a.hidden) return false
  if (a.fieldType === 'Tx' || a.fieldType === 'Ch') return true
  return a.fieldType === 'Btn' && !a.pushButton
}

function kindOf(a: RawWidget): FieldKind {
  if (a.fieldType === 'Tx') return 'text'
  if (a.fieldType === 'Ch') return 'choice'
  return a.radioButton ? 'radio' : 'checkbox'
}

function valueOf(a: RawWidget, kind: FieldKind): FormValue {
  const v = a.fieldValue
  if (kind === 'checkbox') return typeof v === 'string' && v !== 'Off' && v === (a.exportValue ?? v)
  if (kind === 'radio') return typeof v === 'string' && v !== 'Off' ? v : ''
  if (kind === 'choice') return Array.isArray(v) ? (a.multiSelect ? v.map(String) : String(v[0] ?? '')) : typeof v === 'string' ? v : ''
  return typeof v === 'string' ? v : ''
}

/** The fillable fields of one page. */
export async function readPageWidgets(page: PdfjsPage, pageNumber: number): Promise<FormWidget[]> {
  const vp = page.getViewport({ scale: 1 })
  const out: FormWidget[] = []
  for (const a of await page.getAnnotations()) {
    if (!isFillableWidget(a) || !a.fieldName) continue
    const [x1, y1] = vp.convertToViewportPoint(a.rect[0], a.rect[1])
    const [x2, y2] = vp.convertToViewportPoint(a.rect[2], a.rect[3])
    const kind = kindOf(a)
    out.push({
      id: a.id, page: pageNumber, name: a.fieldName, kind,
      rect: { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) },
      label: a.alternativeText || a.fieldName,
      value: valueOf(a, kind),
      onValue: kind === 'checkbox' ? a.exportValue ?? 'Yes' : kind === 'radio' ? a.buttonValue ?? undefined : undefined,
      options: a.options?.map(o => ({ value: o.exportValue, label: o.displayValue })),
      multiLine: a.multiLine, combo: a.combo, multiSelect: a.multiSelect, readOnly: a.readOnly,
      maxLen: a.maxLen || undefined, password: a.password,
      fontSize: a.defaultAppearanceData?.fontSize ?? 0,
      align: a.textAlignment ?? 0,
    })
  }
  return out
}

/** The values the reader set, by field name. */
export function formValuesOf(annotations: readonly Annotation[]): Map<string, FormValue> {
  const m = new Map<string, FormValue>()
  for (const a of annotations) if (a.type === 'formValue') m.set(a.fieldName, a.value)
  return m
}

export function findFormValue(annotations: readonly Annotation[], name: string): FormValueAnnotation | undefined {
  return annotations.find((a): a is FormValueAnnotation => a.type === 'formValue' && a.fieldName === name)
}

interface Storage { setValue(key: string, value: object): void }

/**
 * Put the reader's values where pdf.js draws fields from, for a page about to
 * be printed. pdf.js stores a radio button's or check box's state per widget.
 */
export async function applyFormStorage(doc: ViewerDoc, pageNumber: number, annotations: readonly Annotation[]): Promise<void> {
  const storage = (doc as unknown as { annotationStorage?: Storage }).annotationStorage
  if (!storage) return
  const values = formValuesOf(annotations)
  if (values.size === 0) return
  const page = await doc.getPage(pageNumber) as unknown as PdfjsPage
  for (const w of await readPageWidgets(page, pageNumber)) {
    if (!values.has(w.name)) continue
    const v = values.get(w.name)!
    if (w.kind === 'checkbox') storage.setValue(w.id, { noView: true, value: v === true })
    else if (w.kind === 'radio') storage.setValue(w.id, { noView: true, value: v === w.onValue })
    else storage.setValue(w.id, { noView: true, value: v })
  }
}
