import { useMemo, useState } from 'react'
import type { ParsedEmail, EmailAttachment } from '../../services/emlParser'
import { renderEmailHtml, renderEmailText } from '../../services/emailHtml'
import { downloadBlob } from '../../utils/download'
import { classifyDocFile } from '../../utils/detectDocType'
import { FLOW_PRINT_ATTR } from '../../services/htmlPrint'
import { ReaderFullscreen } from '../reader/ReaderFullscreen'
import { t } from '../../i18n'

interface EmailViewProps {
  email: ParsedEmail
  /** Open an attachment in the viewer itself (PDF/HWP only). */
  onOpenAttachment: (file: File) => void
  /** Display zoom — scales the type, since there is no page to scale. */
  zoom: number
  /** Present the message fullscreen instead of inside the app shell. */
  fullscreen: boolean
  /** Called when the browser leaves fullscreen, however that happened. */
  onExitFullscreen: () => void
}

/** Message size at zoom 1; everything inside is relative to it. */
const BASE_FONT_PX = 15

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** An attachment becomes a real File so it can go straight into the normal
 *  open pipeline — the viewer then treats it like any other document. */
function toFile(a: EmailAttachment): File {
  // Copy into a fresh buffer: the parser's view may sit inside a larger one.
  return new File([new Uint8Array(a.bytes)], a.filename, { type: a.mimeType })
}

function AttachmentRow({ a, onOpen }: { a: EmailAttachment; onOpen: (f: File) => void }) {
  const file = useMemo(() => toFile(a), [a])
  const canOpenHere = classifyDocFile(file).supported

  return (
    <li className="flex items-center gap-3 py-2 border-t border-gray-200 first:border-t-0">
      <span className="flex-1 min-w-0">
        <span className="block truncate text-sm text-gray-800" title={a.filename}>{a.filename}</span>
        <span className="block text-xs text-gray-500">{formatSize(a.size)}</span>
      </span>
      {canOpenHere && (
        <button
          onClick={() => onOpen(file)}
          className="no-print shrink-0 px-2.5 py-1 text-xs rounded-full text-blue-700 hover:bg-blue-50 transition-colors"
        >
          {t('email.openHere')}
        </button>
      )}
      <button
        onClick={() => downloadBlob(new Blob([new Uint8Array(a.bytes)], { type: a.mimeType }), a.filename)}
        className="no-print shrink-0 px-2.5 py-1 text-xs rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
      >
        {t('email.download')}
      </button>
    </li>
  )
}

/**
 * Reads a saved message. Deliberately NOT part of the Konva/page pipeline: mail
 * is reflowing HTML with no page geometry, so rendering it to a canvas would
 * cost text fidelity and selection for nothing.
 */
export function EmailView({
  email, onOpenAttachment, zoom, fullscreen, onExitFullscreen,
}: EmailViewProps) {
  const [showRemoteImages, setShowRemoteImages] = useState(false)

  const body = useMemo(() => {
    if (email.html) return renderEmailHtml(email.html, showRemoteImages)
    if (email.text) return { html: renderEmailText(email.text), blockedImages: 0 }
    return { html: '', blockedImages: 0 }
  }, [email.html, email.text, showRemoteImages])

  const hasBody = body.html.trim().length > 0

  const message = (
    // Zoom has no page to scale here, so it scales the type. Everything inside
    // is sized in `em` for that reason — a Tailwind `text-sm` would be rem-based
    // and stay stubbornly put while the rest of the message grew.
    <article
      className="mx-auto max-w-3xl bg-white shadow-xl rounded-sm"
      style={{ fontSize: `${BASE_FONT_PX * zoom}px` }}
      {...{ [FLOW_PRINT_ATTR]: '' }}
    >
        {/* Envelope */}
        <header className="px-6 pt-6 pb-4 border-b border-gray-200">
          <h1 className="text-[1.35em] font-semibold text-gray-900 break-words">
            {email.subject || t('email.noSubject')}
          </h1>
          <dl className="mt-3 space-y-1 text-[0.92em]">
            {([
              ['email.from', email.from],
              ['email.to', email.to],
              ['email.cc', email.cc],
              ['email.date', email.date],
            ] as const).filter(([, v]) => v).map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="shrink-0 w-14 text-gray-500">{t(key)}</dt>
                <dd className="min-w-0 flex-1 text-gray-800 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </header>

        {/* Remote images are held back until asked for — loading one tells the
            sender the message was opened. */}
        {body.blockedImages > 0 && (
          <div className="no-print flex items-center gap-3 px-6 py-2.5 bg-amber-50 border-b border-amber-200 text-[0.92em]">
            <span className="flex-1 text-amber-900">
              {t('email.imagesBlocked', { n: body.blockedImages })}
            </span>
            <button
              onClick={() => setShowRemoteImages(true)}
              className="shrink-0 px-3 py-1 rounded-full bg-amber-500/15 text-amber-900 hover:bg-amber-500/25 text-[0.8em] font-medium transition-colors"
            >
              {t('email.loadImages')}
            </button>
          </div>
        )}

        {/* Body. Sanitized in emailHtml.ts — see that module for what is stripped. */}
        {hasBody ? (
          <div
            className="wz-email-body px-6 py-5 text-[0.95em] text-gray-900 break-words"
            dangerouslySetInnerHTML={{ __html: body.html }}
          />
        ) : (
          <p className="px-6 py-8 text-[0.92em] text-gray-500 text-center">{t('email.noBody')}</p>
        )}

        {email.attachments.length > 0 && (
          <section className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-sm">
            <h2 className="text-[0.78em] font-semibold uppercase tracking-wide text-gray-500 mb-1">
              {t('email.attachments')} ({email.attachments.length})
            </h2>
            <ul>
              {email.attachments.map((a, i) => (
                <AttachmentRow key={`${a.filename}-${i}`} a={a} onOpen={onOpenAttachment} />
              ))}
            </ul>
          </section>
        )}
    </article>
  )

  // Presenting a message means the message, full width — the app shell around
  // it (and the attachment actions) are not part of what is being shown.
  if (fullscreen) return <ReaderFullscreen onExit={onExitFullscreen}>{message}</ReaderFullscreen>

  return (
    <div className="h-full overflow-auto bg-gray-300 py-6 px-4">
      {message}
    </div>
  )
}
