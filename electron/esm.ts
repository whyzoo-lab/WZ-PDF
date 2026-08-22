/**
 * A real dynamic `import()`, kept out of TypeScript's reach.
 *
 * The main process is compiled to CommonJS, and tsc rewrites a literal
 * `import()` into a `require()` call — which cannot load an ES module. Building
 * the import through `Function` leaves it untouched in the emitted JavaScript.
 *
 * Two dependencies need this: rhwp's `rhwp.js` (HWP ⇄ HWPX conversion) and the
 * vendored Supertonic `helper.js` (text-to-speech). Both are published as ES
 * modules and neither may be edited to suit us, so the workaround lives here
 * instead — one place to delete on the day the main process is itself ESM.
 *
 * Callers pass a `file://` URL (see `node:url`'s `pathToFileURL`), not a bare
 * path: a Windows path like `D:\a\b.js` is not a valid module specifier.
 */
export const importEsm = new Function('specifier', 'return import(specifier)') as
  <T = Record<string, unknown>>(specifier: string) => Promise<T>
