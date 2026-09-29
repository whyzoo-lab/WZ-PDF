// The installer ships no node_modules except the ones electron-builder.json5
// lists by name (see the note on "files" there). A runtime dependency of the
// main process whose own dependency is missing from that list still works in
// `npm run dev` and fails only in the installed app, with "Cannot find module".
// This walks each one's production dependencies and checks every package is
// listed — so an electron-updater or onnxruntime-node upgrade that adds a
// dependency fails here instead.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const MAIN_PROCESS_RUNTIME_DEPENDENCIES = ['electron-updater', 'onnxruntime-node']

// Dependencies of a package's *install script*, never required at runtime —
// deliberately left out of the installer (see the note in electron-builder.json5).
const INSTALL_ONLY: Record<string, string[]> = {
  'onnxruntime-node': ['adm-zip', 'global-agent'],
}

const root = path.resolve('.')

/**
 * Where Node would find `name` from inside `from`: the nearest node_modules
 * going up. Found by walking rather than require.resolve, which refuses
 * `pkg/package.json` for packages whose "exports" do not list it.
 */
function locate(name: string, from: string): string {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
    if (path.dirname(dir) === dir) throw new Error(`${name} not installed (needed from ${from})`)
  }
}

function packageDirs(name: string, from: string, seen: Set<string>, skip: readonly string[] = []): void {
  const dir = locate(name, from)
  const manifest = path.join(dir, 'package.json')
  if (seen.has(dir)) return
  seen.add(dir)
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { dependencies?: Record<string, string> }
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (!skip.includes(dep)) packageDirs(dep, dir, seen)
  }
}

describe('packaged main-process dependencies', () => {
  const config = fs.readFileSync(path.join(root, 'electron-builder.json5'), 'utf8')
  const listed = new Set([...config.matchAll(/"(node_modules\/[^"!*]+?)\/\*\*\/\*"/g)].map(m => m[1]))

  for (const name of MAIN_PROCESS_RUNTIME_DEPENDENCIES) {
    it(`ships everything ${name} needs`, () => {
      const dirs = new Set<string>()
      packageDirs(name, root, dirs, INSTALL_ONLY[name])
      // electron-builder 26 flattens the tree as it copies and applies these
      // patterns to the destination: a nested node_modules/a/node_modules/b
      // is written to node_modules/b. So each package is listed by name at
      // the top level, wherever npm happened to put it.
      const missing = [...dirs]
        .map(dir => (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name: string }).name)
        .map(name => `node_modules/${name}`)
        .filter(entry => !listed.has(entry))
      expect(missing, 'add these to "files" in electron-builder.json5').toEqual([])
    })
  }
})
