// Filling a PDF's form fields on save, with pdf-lib (see pdfForms.ts for the
// rest: reading the fields, showing them, printing them).

import { PDFBool, PDFCheckBox, PDFDropdown, PDFName, PDFOptionList, PDFRadioGroup, PDFTextField } from '@cantoo/pdf-lib'
import type { PDFDocument, PDFFont } from '@cantoo/pdf-lib'
import type { FormValue } from '../types/annotation'

/**
 * Write the values into a pdf-lib document. Fields are found by their full
 * name; one that is missing, read-only or refuses the value is left as it was
 * (a form from the wild must not fail the whole save). Appearances are
 * redrawn with `font` when a value needs it (Korean), else Helvetica.
 */
export function fillForm(doc: PDFDocument, values: Map<string, FormValue>, font: PDFFont | null): string[] {
  const failed: string[] = []
  if (values.size === 0) return failed
  let form
  try { form = doc.getForm() } catch { return [...values.keys()] }
  for (const [name, v] of values) {
    try {
      const field = form.getField(name)
      if (field instanceof PDFTextField) field.setText(String(v) || undefined)
      else if (field instanceof PDFCheckBox) { if (v === true) field.check(); else field.uncheck() }
      else if (field instanceof PDFRadioGroup) { if (typeof v === 'string' && v) field.select(v); else field.clear() }
      else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        const picked = Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []
        if (picked.length) field.select(picked); else field.clear()
      } else failed.push(name)
    } catch {
      failed.push(name)
    }
  }
  try {
    if (font) form.updateFieldAppearances(font)
    else form.updateFieldAppearances()
  } catch {
    // An appearance that cannot be drawn: readers draw the field from its value.
    try { form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True) } catch { /* left as it is */ }
  }
  return failed
}
