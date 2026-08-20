/**
 * Compile the console launchers (cli/wzconvert.cs → build/<tool>.exe).
 *
 * One source becomes three executables — hwp2pdf, hwp2hwpx, hwpx2hwp — because
 * each decides what to convert from its own file name. Only the output name
 * differs between the three compilations.
 *
 * Uses the C# compiler that is part of Windows itself (.NET Framework 4.x), so
 * building WZ PDF still needs nothing beyond Node — no Visual Studio, no Rust,
 * no Go. The results are ~5 KB console-subsystem executables, which is the
 * whole point: `WZ PDF.exe` is GUI-subsystem and cannot print to the terminal
 * it was started from. See cli/wzconvert.cs.
 *
 * Skipped with a warning off Windows, so `npm run build` still works on a Mac
 * or in a Linux CI container that only builds the web bundle.
 */

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SOURCE = path.join(ROOT, 'cli', 'wzconvert.cs')
const OUT_DIR = path.join(ROOT, 'build')

/** Must match the `Tools` allowlist in cli/wzconvert.cs and the `flag` values
 *  of CONVERTERS in electron/cli.ts. */
const TOOLS = ['hwp2pdf', 'hwp2hwpx', 'hwpx2hwp']

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
    console.warn('[build-cli] not Windows — skipping the console launchers')
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

  fs.mkdirSync(OUT_DIR, { recursive: true })
  for (const tool of TOOLS) {
    const output = path.join(OUT_DIR, `${tool}.exe`)
    execFileSync(csc, [
      '-nologo',
      '-optimize+',
      '-warnaserror+',
      '-target:exe',          // console subsystem — the reason these exist
      '-platform:anycpu',
      '-out:' + output,
      SOURCE,
    ], { stdio: 'inherit' })
    const kb = (fs.statSync(output).size / 1024).toFixed(1)
    console.log(`[build-cli] ${tool}.exe built (${kb} KB)`)
  }
}

main()
