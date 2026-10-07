/**
 * Fail fast when a build output is in use, instead of letting electron-builder
 * wait for it forever.
 *
 * A portable build that is running (release/WZ_PDF_<version>.exe, launched to
 * try the build) keeps its own file open for as long as the app is open. The
 * next `build:exe` writes the same file name, and electron-builder's answer is
 * "output file is locked for writing (maybe by virus scanner) => waiting for
 * unlock..." — with no end. This checks the files the build is about to write
 * and names what is holding them.
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const { version } = require(path.join(ROOT, 'package.json'))
const RELEASE = path.join(ROOT, 'release')

const outputs = [`WZ_PDF_${version}.exe`, `WZ_PDF_Setup_${version}.exe`]
  .map(name => path.join(RELEASE, name))
  .filter(file => fs.existsSync(file))

function isLocked(file) {
  try {
    // Opening for write fails with EBUSY/EPERM while another process has the
    // file open without sharing — exactly what makes electron-builder wait.
    fs.closeSync(fs.openSync(file, 'r+'))
    return false
  } catch (err) {
    return err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES'
  }
}

/** Processes started from this release folder (Windows only; best effort). */
function runningFromRelease() {
  if (process.platform !== 'win32') return []
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      `Get-Process | Where-Object { $_.Path -like '${RELEASE.replace(/'/g, "''")}\\*' } | ForEach-Object { "$($_.Id) $($_.Path)" }`,
    ], { encoding: 'utf8', windowsHide: true })
    return out.split(/\r?\n/).filter(Boolean)
  } catch {
    return []
  }
}

const locked = outputs.filter(isLocked)
if (locked.length > 0) {
  console.error('')
  console.error('[build] These outputs are in use, so the build cannot replace them:')
  for (const file of locked) console.error(`  ${path.relative(ROOT, file)}`)
  const procs = runningFromRelease()
  if (procs.length > 0) {
    console.error('')
    console.error('  Started from release/ and still running (close the app, then build again):')
    for (const p of procs) console.error(`    PID ${p}`)
  } else {
    console.error('  Close any WZ PDF started from release/ (or an installer you opened from there), then build again.')
  }
  console.error('')
  process.exit(1)
}
