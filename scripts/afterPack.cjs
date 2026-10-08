/**
 * electron-builder afterPack hook — runs for each target, after win-unpacked
 * is prepared and before it is packaged.
 *
 * 1. Removes Chromium's WebGPU shader compiler (dxcompiler.dll, dxil.dll —
 *    ~27 MB on disk, ~7 MB in the installer). Nothing here uses WebGPU: OCR
 *    runs onnxruntime-web on the wasm backend and read-aloud is native. Checked
 *    in the packaged build with both removed: OCR recognized a test page and a
 *    HWPX opened, with no errors. d3dcompiler_47.dll stays — ANGLE (the GPU
 *    path for ordinary 2D drawing) needs it.
 *
 * 2. Describes the Viewer EXE template instead of carrying it. The installed
 *    app used to bundle the portable as resources/viewer-template.exe —
 *    ~136 MB of a ~289 MB installer, for a feature most installs never use,
 *    and re-downloaded by every automatic update. The NSIS pass now writes
 *    resources/viewer-template.json (file name, size, SHA-512 of the portable
 *    this same build produced), and the app fetches and verifies the portable
 *    the first time it is needed (electron/viewerTemplate.ts).
 *
 * Sequencing: `build:exe` runs portable first, then NSIS, sharing
 * win-unpacked. The pass is identified by the target being packed, never by
 * whether the portable artifact exists — that older test copied a template
 * into the portable's own resources on a rebuild and doubled both artifacts.
 */

const crypto = require('crypto')
const fs     = require('fs')
const path   = require('path')

/** Chromium files only WebGPU needs. */
const WEBGPU_ONLY = ['dxcompiler.dll', 'dxil.dll']

exports.default = async function (context) {
  const { appOutDir, packager, targets } = context
  const version = packager.appInfo.version
  const resources = path.join(appOutDir, 'resources')
  const manifestPath = path.join(resources, 'viewer-template.json')
  const isNsisPass = (targets || []).some(target => target.name === 'nsis')

  for (const name of WEBGPU_ONLY) {
    const file = path.join(appOutDir, name)
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true })
      console.log(`[afterPack] Removed ${name} (WebGPU only)`)
    }
  }

  // Whatever an earlier pass left in the shared win-unpacked. The bundled
  // template is gone for good; the manifest belongs to the installer only.
  fs.rmSync(path.join(resources, 'viewer-template.exe'), { force: true })
  fs.rmSync(manifestPath, { force: true })
  if (!isNsisPass) return

  const file = `WZ_Reader_${version}.exe`
  const portable = path.join(packager.projectDir, 'release', file)
  if (!fs.existsSync(portable)) {
    console.warn('[afterPack] portable artifact missing — the installed app cannot make Viewer EXEs')
    return
  }
  const sha512 = crypto.createHash('sha512').update(fs.readFileSync(portable)).digest('base64')
  const manifest = { version, file, size: fs.statSync(portable).size, sha512 }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log(`[afterPack] viewer-template.json → ${file} (${(manifest.size / 1048576).toFixed(1)} MB, fetched on first use)`)
}
