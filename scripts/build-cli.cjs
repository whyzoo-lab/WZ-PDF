/**
 * Compile the `hwp2pdf` console launcher (cli/hwp2pdf.cs → build/hwp2pdf.exe).
 *
 * Uses the C# compiler that is part of Windows itself (.NET Framework 4.x), so
 * building WZ PDF still needs nothing beyond Node — no Visual Studio, no Rust,
 * no Go. The result is a ~4 KB console-subsystem executable, which is the whole
 * point: `WZ PDF.exe` is GUI-subsystem and cannot print to the terminal it was
 * started from. See cli/hwp2pdf.cs.
 *
 * Skipped with a warning off Windows, so `npm run build` still works on a Mac
 * or in a Linux CI container that only builds the web bundle.
 */

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SOURCE = path.join(ROOT, 'cli', 'hwp2pdf.cs')
const OUTPUT = path.join(ROOT, 'build', 'hwp2pdf.exe')

/** Both compilers ship with Windows; prefer the 64-bit one. */
const CSC_CANDIDATES = [
  'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  'Microsoft.NET/Framework/v4.0.30319/csc.exe',
].map(rel => path.join(process.env.SystemRoot || 'C:\\Windows', ...rel.split('/')))

function findCsc() {
  return CSC_CANDIDATES.find(candidate => fs.existsSync(candidate)) ?? null
}

function main() {
  if (process.platform !== 'win32') {
    console.warn('[build-cli] not Windows — skipping hwp2pdf.exe')
    return
  }
  const csc = findCsc()
  if (!csc) {
    // Fail loudly: silently shipping an installer without the CLI would look
    // like the feature was removed.
    console.error('[build-cli] csc.exe not found. Expected one of:')
    CSC_CANDIDATES.forEach(c => console.error('  ' + c))
    process.exit(1)
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })
  execFileSync(csc, [
    '-nologo',
    '-optimize+',
    '-warnaserror+',
    '-target:exe',          // console subsystem — the reason this exists
    '-platform:anycpu',
    '-out:' + OUTPUT,
    SOURCE,
  ], { stdio: 'inherit' })

  const kb = (fs.statSync(OUTPUT).size / 1024).toFixed(1)
  console.log(`[build-cli] hwp2pdf.exe built (${kb} KB)`)
}

main()
