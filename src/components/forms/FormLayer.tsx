import { memo, useContext, useEffect, useState } from 'react'
import type { ViewerDoc } from '../../types/viewerDoc'
import type { FormValue } from '../../types/annotation'
import { readPageWidgets, type FormWidget } from '../../services/pdfForms'
import { FormContext } from './formContext'
import { useDraftCommit } from '../../hooks/useDraftCommit'

/**
 * A page's fillable fields as real controls over the page, as Acrobat Reader
 * shows them: tinted while empty-looking, white while typing. Laid out on the
 * unrotated page and turned with it by CSS (`.wz-form-layer[data-main-rotation]`,
 * as the text layers are). The page picture has the fields hidden
 * (pdfCommentImport `hidePageComments`), so an edited value never shows twice.
 */
export const FormLayer = memo(function FormLayer({ pdfDoc, pageNumber, scale, rotation, width, height, values }: {
  pdfDoc: ViewerDoc
  pageNumber: number
  /** CSS px per PDF point. */
  scale: number
  rotation: number
  /** The page as shown (turned box). */
  width: number
  height: number
  /** What the reader filled in, by field name. */
  values: Map<string, FormValue>
}) {
  const { canFill, setField } = useContext(FormContext)
  const [loaded, setLoaded] = useState<{ doc: ViewerDoc; page: number; widgets: FormWidget[] } | null>(null)
  useEffect(() => {
    let cancelled = false
    // Inside the chain: a page that cannot be had (or a document without
    // pages to ask, as in tests) is a page without fields, not an error.
    Promise.resolve()
      .then(() => pdfDoc.getPage(pageNumber))
      .then(page => readPageWidgets(page as never, pageNumber))
      .then(widgets => { if (!cancelled) setLoaded({ doc: pdfDoc, page: pageNumber, widgets }) })
      .catch(() => { if (!cancelled) setLoaded({ doc: pdfDoc, page: pageNumber, widgets: [] }) })
    return () => { cancelled = true }
  }, [pdfDoc, pageNumber])

  const widgets = loaded && loaded.doc === pdfDoc && loaded.page === pageNumber ? loaded.widgets : []
  if (widgets.length === 0) return null
  const turned = rotation % 180 !== 0
  return (
    <div
      className="wz-form-layer no-print"
      data-main-rotation={rotation}
      style={{ position: 'absolute', top: 0, left: 0, width: turned ? height : width, height: turned ? width : height, pointerEvents: 'none' }}
    >
      {widgets.map(w => (
        <Field key={w.id} w={w} scale={scale} value={values.has(w.name) ? values.get(w.name)! : w.value}
          disabled={!canFill || !!w.readOnly}
          onChange={v => setField(w.name, v, w.page, w.value)} />
      ))}
    </div>
  )
})

const FIELD = 'absolute box-border border-0 m-0 text-black outline-none bg-[rgba(204,215,255,0.5)] hover:bg-[rgba(204,215,255,0.8)] focus:bg-white focus:ring-2 focus:ring-blue-500 disabled:cursor-default disabled:bg-transparent'

function Field({ w, scale, value, disabled, onChange }: {
  w: FormWidget; scale: number; value: FormValue; disabled: boolean; onChange: (v: FormValue) => void
}) {
  const box = { left: w.rect.x * scale, top: w.rect.y * scale, width: w.rect.width * scale, height: w.rect.height * scale }
  // The field's own size, else one that fits the box (Acrobat's "auto").
  const fontSize = (w.fontSize > 0 ? w.fontSize : Math.max(6, Math.min(w.multiLine ? 11 : w.rect.height * 0.7, 14))) * scale
  const common = { 'aria-label': w.label, title: w.label, disabled, style: { ...box, fontSize, pointerEvents: 'auto' as const } }

  if (w.kind === 'checkbox' || w.kind === 'radio') {
    const on = w.kind === 'checkbox' ? value === true : value === w.onValue
    const mark = Math.min(box.width, box.height) * 0.8
    return (
      <button
        type="button"
        role={w.kind}
        aria-checked={on}
        {...common}
        onClick={() => onChange(w.kind === 'checkbox' ? !on : (w.onValue ?? ''))}
        className={`${FIELD} flex items-center justify-center p-0 ${w.kind === 'radio' ? 'rounded-full' : ''}`}
      >
        {on && (w.kind === 'radio'
          ? <span className="rounded-full bg-black" style={{ width: mark * 0.55, height: mark * 0.55 }} />
          : <svg viewBox="0 0 20 20" width={mark} height={mark} fill="none" stroke="black" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 10.5l4 4 8-9" /></svg>)}
      </button>
    )
  }

  if (w.kind === 'choice') {
    const opts = w.options ?? []
    if (w.combo || !w.multiSelect) {
      const v = Array.isArray(value) ? value[0] ?? '' : String(value)
      return (
        <select {...common} value={v} onChange={e => onChange(e.target.value)} className={`${FIELD} px-0.5`}>
          {!opts.some(o => o.value === v) && <option value={v}>{v}</option>}
          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    }
    const v = Array.isArray(value) ? value : value ? [String(value)] : []
    return (
      <select {...common} multiple value={v} onChange={e => onChange([...e.target.selectedOptions].map(o => o.value))} className={`${FIELD} px-0.5`}>
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }

  return <TextField w={w} common={common} value={String(value ?? '')} onChange={onChange} />
}

/** A text field, stored when the reader pauses or leaves it (hooks/useDraftCommit). */
function TextField({ w, common, value, onChange }: {
  w: FormWidget
  common: { 'aria-label': string; title: string; disabled: boolean; style: React.CSSProperties }
  value: string
  onChange: (v: FormValue) => void
}) {
  const { shown, onChange: type, flush } = useDraftCommit(value, onChange)
  const align = w.align === 1 ? 'center' : w.align === 2 ? 'right' : 'left'
  if (w.multiLine) {
    return (
      <textarea {...common} value={shown} maxLength={w.maxLen}
        onChange={e => type(e.target.value)} onBlur={flush}
        onKeyDown={e => e.stopPropagation()}
        className={`${FIELD} resize-none px-0.5 leading-tight`} style={{ ...common.style, textAlign: align }} />
    )
  }
  return (
    <input {...common} type={w.password ? 'password' : 'text'} value={shown} maxLength={w.maxLen}
      onChange={e => type(e.target.value)} onBlur={flush}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur() }}
      className={`${FIELD} px-0.5`} style={{ ...common.style, textAlign: align }} />
  )
}
