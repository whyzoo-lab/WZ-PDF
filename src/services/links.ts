/**
 * Make every link in a sanitised document leave the app — a new window, which
 * the main process hands to the OS browser — rather than navigate it, and stop
 * the opened page reaching back through `window.opener`.
 *
 * Every `<a>`, not `a[href]`: an SVG anchor names its target in `xlink:href`,
 * which that selector misses, and DOMPurify keeps it. Clicked, it navigated the
 * main window itself.
 */
export function openLinksOutside(doc: Document, keepInPageAnchors = false): void {
  for (const a of Array.from(doc.querySelectorAll('a'))) {
    const href = a.getAttribute('href') ?? a.getAttribute('xlink:href')
    if (href === null) continue
    if (keepInPageAnchors && href.startsWith('#')) continue
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  }
}
