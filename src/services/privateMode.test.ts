import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { loadPrivateMode, parsePrivateConfig, pickPrivateDocument } from './privateMode'

const CONFIG_URL = 'https://intra.example.com/viewer/private.json'

function response(status: number, body: string, url = CONFIG_URL): Response {
  return { status, ok: status >= 200 && status < 300, url, text: async () => body } as Response
}

describe('parsePrivateConfig', () => {
  it('resolves documents against the config file and keeps or derives a name', () => {
    const c = parsePrivateConfig({
      documents: {
        rfp: 'docs/RFP%202026.pdf',
        notice: { url: '/files/get?id=17', name: '공지.hwp' },
      },
    }, CONFIG_URL)
    expect(c.documents.get('rfp')).toEqual({ url: 'https://intra.example.com/viewer/docs/RFP%202026.pdf', name: 'RFP 2026.pdf' })
    expect(c.documents.get('notice')).toEqual({ url: 'https://intra.example.com/files/get?id=17', name: '공지.hwp' })
    expect(c.print).toBe(false)
  })

  it('accepts the example shipped in the deploy folder as it stands', () => {
    // public/private.example.json is what an administrator copies to
    // private.json; it must work once renamed, its _readme key included.
    const raw = JSON.parse(readFileSync('public/private.example.json', 'utf8'))
    const c = parsePrivateConfig(raw, CONFIG_URL)
    expect(c.documents.get('sample')?.url).toBe('https://intra.example.com/viewer/sample.pdf')
    expect(c.documents.get('notice')?.name).toBe('notice.hwp')
    expect(c.print).toBe(false)
  })

  it('takes only the file part of a given name', () => {
    const c = parsePrivateConfig({ documents: { a: { url: 'a.pdf', name: '../../x/보고서.pdf' } } }, CONFIG_URL)
    expect(c.documents.get('a')?.name).toBe('보고서.pdf')
  })

  it('allows printing only when asked', () => {
    expect(parsePrivateConfig({ documents: { a: 'a.pdf' }, print: true }, CONFIG_URL).print).toBe(true)
    expect(() => parsePrivateConfig({ documents: { a: 'a.pdf' }, print: 'yes' }, CONFIG_URL)).toThrow()
  })

  it.each([
    ['no documents object', { print: true }],
    ['an empty list', { documents: {} }],
    ['an array', { documents: ['a.pdf'] }],
    ['an entry without url', { documents: { a: { name: 'a.pdf' } } }],
    ['a javascript: url', { documents: { a: 'javascript:alert(1)' } }],
    ['a data: url', { documents: { a: 'data:application/pdf;base64,AA' } }],
  ])('refuses %s', (_label, raw) => {
    expect(() => parsePrivateConfig(raw, CONFIG_URL)).toThrow()
  })
})

describe('pickPrivateDocument', () => {
  const two = parsePrivateConfig({ documents: { a: 'a.pdf', b: 'b.pdf' } }, CONFIG_URL)
  const one = parsePrivateConfig({ documents: { only: 'only.pdf' } }, CONFIG_URL)

  it('opens the document asked for, and nothing that is not listed', () => {
    expect(pickPrivateDocument(two, 'b')?.name).toBe('b.pdf')
    expect(pickPrivateDocument(two, 'c')).toBeNull()
    // Inherited object keys are not documents.
    expect(pickPrivateDocument(two, 'constructor')).toBeNull()
    expect(pickPrivateDocument(two, '__proto__')).toBeNull()
  })

  it('needs ?doc when there is more than one, not when there is one', () => {
    expect(pickPrivateDocument(two, null)).toBeNull()
    expect(pickPrivateDocument(one, null)?.name).toBe('only.pdf')
  })
})

describe('loadPrivateMode', () => {
  const base = 'https://intra.example.com/viewer/app.html?doc=a'

  it('is off when the deployment has no config', async () => {
    for (const status of [404, 403, 410]) {
      expect(await loadPrivateMode(base, vi.fn(async () => response(status, ''))))
        .toEqual({ status: 'off' })
    }
  })

  it('is off when the server answers every path with the app page', async () => {
    const fetchFn = vi.fn(async () => response(200, '<!doctype html><html></html>'))
    expect(await loadPrivateMode(base, fetchFn)).toEqual({ status: 'off' })
  })

  it('reads the config next to the app, uncached', async () => {
    const fetchFn = vi.fn(async () => response(200, JSON.stringify({ documents: { a: 'a.pdf' } })))
    const mode = await loadPrivateMode(base, fetchFn)
    expect(fetchFn).toHaveBeenCalledWith(CONFIG_URL, { cache: 'no-store' })
    expect(mode.status).toBe('on')
  })

  it('stays closed when a config exists but cannot be used', async () => {
    const bad = [
      vi.fn(async () => response(500, '')),
      vi.fn(async () => response(200, '{ not json')),
      vi.fn(async () => response(200, JSON.stringify({ documents: {} }))),
      vi.fn(async () => { throw new TypeError('network') }),
    ]
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const fetchFn of bad) {
      expect(await loadPrivateMode(base, fetchFn)).toEqual({ status: 'error' })
    }
  })

  it('is off when opened from disk', async () => {
    const fetchFn = vi.fn()
    expect(await loadPrivateMode('file:///C:/wz/app.html', fetchFn)).toEqual({ status: 'off' })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
