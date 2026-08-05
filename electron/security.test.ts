import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  hasSupportedDocumentSignature,
  isNonPublicIp,
  isTrustedRendererUrl,
  isTrustedUpdateUrl,
  parseHttpUrl,
  resolveAppAssetPath,
} from './security.ts'

describe('Electron security helpers', () => {
  it('only trusts the exact renderer origins', () => {
    expect(isTrustedRendererUrl('app://bundle/app.html')).toBe(true)
    expect(isTrustedRendererUrl('app://attacker/app.html')).toBe(false)
    expect(isTrustedRendererUrl('app://bundle:1234/app.html')).toBe(false)
    expect(isTrustedRendererUrl('http://localhost:5173/app.html')).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5173.evil.test/app.html')).toBe(false)
    expect(isTrustedRendererUrl('https://localhost:5173/app.html')).toBe(false)
    expect(isTrustedRendererUrl('http://user@localhost:5173/app.html')).toBe(false)
  })

  it('keeps app protocol paths inside dist', () => {
    const root = path.resolve('dist')
    expect(resolveAppAssetPath(root, 'app://bundle/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'))
    // URL parsing collapses encoded dot segments, but the result stays in dist.
    expect(resolveAppAssetPath(root, 'app://bundle/%2e%2e/secret.txt')).toBe(path.join(root, 'secret.txt'))
    expect(resolveAppAssetPath(root, 'app://bundle/%5c..%5csecret.txt')).toBeNull()
    expect(resolveAppAssetPath(root, 'app://other/assets/app.js')).toBeNull()
  })

  it('rejects unsafe URL forms and validates the update origin exactly', () => {
    expect(() => parseHttpUrl('file:///tmp/a.pdf')).toThrow(/http/)
    expect(() => parseHttpUrl('https://user:pass@example.com/a.pdf')).toThrow(/credentials/)
    expect(isTrustedUpdateUrl('https://whyzoo.com/WzPDF/download.php', 'https://whyzoo.com')).toBe(true)
    expect(isTrustedUpdateUrl('https://whyzoo.com.evil.test/file', 'https://whyzoo.com')).toBe(false)
  })

  it('classifies private and public IP addresses', () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.1.2', '172.16.0.1', '192.168.1.1', '::1', 'fc00::1']) {
      expect(isNonPublicIp(address), address).toBe(true)
    }
    expect(isNonPublicIp('8.8.8.8')).toBe(false)
    expect(isNonPublicIp('2606:4700:4700::1111')).toBe(false)
  })

  it('recognizes only supported document signatures', () => {
    expect(hasSupportedDocumentSignature(Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).toBe(true)
    expect(hasSupportedDocumentSignature(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true)
    expect(hasSupportedDocumentSignature(Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c]))).toBe(false)
  })
})
