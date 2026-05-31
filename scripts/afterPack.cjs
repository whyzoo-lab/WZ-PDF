/**
 * electron-builder afterPack hook.
 *
 * Bundles the portable WZ_PDF_${version}.exe (built in an earlier
 * `electron-builder --win portable` run) into the NSIS-installed app's
 * `resources/` directory as `viewer-template.exe`. The main process uses
 * this template to create standalone "Viewer EXE" exports — without it,
 * the EXE Viewer feature only works from the portable launcher.
 *
 * Sequencing: `build:exe` runs portable first, then NSIS. afterPack is
 * called after each target's win-unpacked is prepared, before the final
 * package is assembled:
 *
 *   1. Portable build → template doesn't exist yet → this hook skips.
 *   2. Portable artifact written to `release/WZ_PDF_${version}.exe`.
 *   3. NSIS build → template exists → this hook copies it into resources.
 */

const fs   = require('fs')
const path = require('path')

exports.default = async function (context) {
  const { appOutDir, packager } = context
  const version = packager.appInfo.version
  const portableTemplate = path.join(
    packager.projectDir,
    'release',
    `WZ_PDF_${version}.exe`,
  )

  if (!fs.existsSync(portableTemplate)) {
    return // Portable not yet built — this is the portable pass; skip silently.
  }

  const destPath = path.join(appOutDir, 'resources', 'viewer-template.exe')
  const sizeMB = (fs.statSync(portableTemplate).size / 1024 / 1024).toFixed(1)
  fs.copyFileSync(portableTemplate, destPath)
  console.log(`[afterPack] Bundled viewer-template.exe (${sizeMB} MB) → ${destPath}`)
}
