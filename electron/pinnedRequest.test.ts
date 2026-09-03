import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { pinnedRequest, type PinnedTarget } from './security'

/**
 * The DNS-rebinding defence is only real if the socket goes to the address the
 * check vetted, whatever the hostname resolves to *now*. So: a server on
 * 127.0.0.1, a target whose hostname is a name that does not resolve at all,
 * and an address pinned to the server. If the request lands, the hostname was
 * never looked up again — and the Host header still names the host, which is
 * what a virtual-hosted CDN needs.
 */
let server: http.Server
let port: number
let seenHost = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seenHost = req.headers.host ?? ''
    if (req.url === '/hop') {
      res.writeHead(302, { location: '/final' })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end('%PDF-pinned')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

const target = (pathname: string): PinnedTarget => ({
  url: new URL(`http://does-not-resolve.invalid:${port}${pathname}`),
  address: '127.0.0.1',
  family: 4,
})

describe('pinnedRequest', () => {
  it('connects to the vetted address, not to whatever the name resolves to', async () => {
    const res = await pinnedRequest(target('/'), AbortSignal.timeout(5000))
    let body = ''
    for await (const chunk of res.body as AsyncIterable<Buffer>) body += chunk.toString()
    expect(res.status).toBe(200)
    expect(body).toBe('%PDF-pinned')
  })

  it('keeps the Host header on the hostname', async () => {
    // A CDN fronting many sites needs the name; only the socket is pinned.
    await pinnedRequest(target('/'), AbortSignal.timeout(5000))
    expect(seenHost).toBe(`does-not-resolve.invalid:${port}`)
  })

  it('does not follow redirects on its own — every hop is the caller\'s to vet', async () => {
    const res = await pinnedRequest(target('/hop'), AbortSignal.timeout(5000))
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('/final')
    res.body.resume()
  })

  it('honours the abort signal', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(pinnedRequest(target('/'), ctrl.signal)).rejects.toThrow()
  })
})
