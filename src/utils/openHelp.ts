import { LANG } from '../i18n'

/**
 * Open the user guide: in the desktop app through the main process (the
 * default browser), on the web in a new tab. Korean UI → help.html, otherwise
 * help.en.html. F1 and the command palette both come here.
 */
export function openHelp(): void {
  if (window.electronAPI?.openHelp) {
    window.electronAPI.openHelp(LANG)
    return
  }
  window.open(`./${LANG === 'ko' ? 'help.html' : 'help.en.html'}`, '_blank', 'noopener,noreferrer')
}
