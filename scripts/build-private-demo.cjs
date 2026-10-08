/**
 * Adds a live private-mode demo to a web build: <dist>/private-demo/.
 *
 * Private mode is switched on for a whole deployment by a private.json next to
 * app.html (src/services/privateMode.ts), so it cannot be shown on the public
 * site without making all of it private. The demo is therefore a second copy of
 * app.html in its own folder, with its own private.json:
 *
 *   private-demo/app.html      app.html with <base href="../"> — every script,
 *                              wasm, font and cmap still comes from the parent,
 *                              so nothing is duplicated
 *   private-demo/private.json  designates ../sample.pdf, printing off
 *
 * The app looks for private.json next to the *page* (location), not next to
 * its <base>, which is what makes this work. Only the GitHub Pages deploy runs
 * this (pages.yml); `npm run build`, the desktop app and deploy.bat never get
 * the folder.
 *
 * Usage: node scripts/build-private-demo.cjs [distDir]
 */
const fs = require('node:fs')
const path = require('node:path')

const dist = path.resolve(process.argv[2] || 'dist')
const source = path.join(dist, 'app.html')
if (!fs.existsSync(source)) {
  console.error(`[private-demo] ${source} not found — run the web build first`)
  process.exit(1)
}

const html = fs.readFileSync(source, 'utf8')
// <base> must come before anything that uses a URL, so it goes first in <head>.
// The demo is a copy of the app, not a page of its own: keep it out of search.
const head = /<head[^>]*>/i
if (!head.test(html)) {
  console.error('[private-demo] app.html has no <head>')
  process.exit(1)
}
const demoHtml = html
  .replace(head, m => `${m}\n    <base href="../" />`)
  .replace(/<meta name="robots"[^>]*>/i, '<meta name="robots" content="noindex, nofollow" />')

const config = {
  _readme: 'Private-mode demo of the WZ Reader site. See private.example.json next to app.html for the format.',
  documents: { sample: '../sample.pdf' },
  print: false,
}

const out = path.join(dist, 'private-demo')
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'app.html'), demoHtml)
fs.writeFileSync(path.join(out, 'private.json'), JSON.stringify(config, null, 2) + '\n')
console.log(`[private-demo] wrote ${path.relative(process.cwd(), out)}/ (app.html + private.json)`)
