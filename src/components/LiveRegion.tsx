/**
 * A polite live region: a sentence a screen reader will read out when it
 * changes, and that nothing else can see.
 *
 * It must be **mounted before the message exists**. A live region inserted into
 * the DOM with its text already in it is not announced by most screen readers —
 * the region has to be there first and then change. Every transient bar in this
 * app (read-aloud, OCR) unmounts the moment its work ends, so none of them can
 * carry its own region: by the time there is something to say, the element that
 * would say it is gone.
 */
export function LiveRegion({ message }: { message: string }) {
  return (
    <p className="sr-only" role="status" aria-live="polite">{message}</p>
  )
}
