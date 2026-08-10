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
 *   1. Portable build → nothing to bundle → this hook clears any stale copy.
 *   2. Portable artifact written to `release/WZ_PDF_${version}.exe`.
 *   3. NSIS build → this hook copies that artifact into resources.
 *
 * The pass is identified by the target being packed, NOT by whether the
 * portable artifact happens to exist. That older test was only correct on a
 * clean tree: rebuilding the same version meant the artifact already existed
 * during the portable pass, so the hook copied a 115 MB template into the
 * portable's own resources and the portable then packaged it — doubling both
 * artifacts on every rebuild (114 MB → 230 MB → 460 MB). CI never saw it
 * because each run starts from a fresh checkout.
 */

const fs   = require('fs')
const path = require('path')

exports.default = async function (context) {
  const { appOutDir, packager, targets } = context
  const version = packager.appInfo.version
  const destPath = path.join(appOutDir, 'resources', 'viewer-template.exe')
  const isNsisPass = (targets || []).some(target => target.name === 'nsis')

  if (!isNsisPass) {
    // Portable pass. win-unpacked is shared between the two invocations, so a
    // template left behind by an earlier NSIS pass would be packaged into the
    // portable itself. Remove it instead.
    fs.rmSync(destPath, { force: true })
    return
  }

  const portableTemplate = path.join(
    packager.projectDir,
    'release',
    `WZ_PDF_${version}.exe`,
  )
  if (!fs.existsSync(portableTemplate)) {
    console.warn('[afterPack] portable template missing — EXE Viewer export will be unavailable')
    return
  }

  const sizeMB = (fs.statSync(portableTemplate).size / 1024 / 1024).toFixed(1)
  fs.copyFileSync(portableTemplate, destPath)
  console.log(`[afterPack] Bundled viewer-template.exe (${sizeMB} MB) → ${destPath}`)
}
