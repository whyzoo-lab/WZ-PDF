#!/usr/bin/env node
/**
 * WZ PDF MCP — HTTP (Streamable HTTP) transport entry point.
 *
 * Lets remote Claude clients (Claude Desktop "Custom Connector", Claude.ai
 * web) connect over the network instead of via local stdio.
 *
 * Environment:
 *   PORT             listen port (default 5051)
 *   MCP_SANDBOX_DIR  REQUIRED. Absolute directory all file paths are clamped
 *                    to — anything outside is rejected. Without this, any
 *                    caller can read/write arbitrary files on the host.
 */

import express, { type Request, type Response } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'

import { tools, callTool } from './tools.js'

const PORT = Number(process.env.PORT ?? 5051)
const HOST = process.env.MCP_HOST ?? '127.0.0.1'
const SANDBOX = process.env.MCP_SANDBOX_DIR
// Optional on loopback, required on any externally reachable bind address.
// When set, every /mcp request must carry `Authorization: Bearer <token>`.
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN

if (!SANDBOX) {
  console.error(
    '[wz-pdf-mcp] REFUSING TO START — MCP_SANDBOX_DIR is not set.\n' +
    '             Set it to a directory you trust the public to read/write,\n' +
    '             e.g. MCP_SANDBOX_DIR=/opt/wz-pdf-mcp/workspace',
  )
  process.exit(1)
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('[wz-pdf-mcp] REFUSING TO START — PORT must be an integer from 1 to 65535')
  process.exit(1)
}

// Required on loopback too. A web page can rebind its own hostname to
// 127.0.0.1 and become same-origin with this server; the token is the only
// thing that then stands between the browser and every tool.
if (!AUTH_TOKEN) {
  console.error('[wz-pdf-mcp] REFUSING TO START — MCP_AUTH_TOKEN is required')
  process.exit(1)
}

function buildServer(): Server {
  const server = new Server(
    { name: 'wz-pdf-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools as unknown as Tool[],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name
    const args = (req.params.arguments ?? {}) as Record<string, unknown>
    try {
      const text = await callTool(name, args)
      return { content: [{ type: 'text' as const, text }] }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        isError: true,
      }
    }
  })

  return server
}

const app = express()
app.disable('x-powered-by')
// Tool arguments contain paths and settings, not PDF bytes. Keep the JSON
// boundary small so unauthenticated parsing cannot consume excessive memory.
app.use(express.json({ limit: '1mb' }))

// Health check for nginx / uptime monitoring (never requires auth).
app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, name: 'wz-pdf-mcp', sandboxConfigured: true, auth: !!AUTH_TOKEN })
})

// Bearer-token gate on /mcp when MCP_AUTH_TOKEN is configured. Uses a
// length-aware constant-ish comparison to avoid trivial timing leaks.
function authorized(req: Request): boolean {
  if (!AUTH_TOKEN) return true
  const header = req.headers['authorization']
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const presented = header.slice('Bearer '.length)
  const expected = Buffer.from(AUTH_TOKEN)
  const actual = Buffer.from(presented)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// Streamable HTTP transport: a fresh transport+server per request, stateless.
// Same pattern as the SDK's "stateless" example — fine because every tool
// call is self-contained (no per-session state to preserve).
const mcpHandler = async (req: Request, res: Response) => {
  if (!authorized(req)) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized' },
      id: null,
    })
    return
  }
  try {
    const server = buildServer()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,  // stateless
      // Reject requests whose Host header is not one of ours: the SDK's guard
      // against DNS rebinding, which the token above backs up.
      enableDnsRebindingProtection: true,
      allowedHosts: ['127.0.0.1', 'localhost', '[::1]', `127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`],
    })
    res.on('close', () => {
      transport.close()
      server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    console.error('[mcp] request error:', err)
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error' },
        id: null,
      })
    }
  }
}

app.post('/mcp', mcpHandler)
app.get('/mcp', mcpHandler)
app.delete('/mcp', mcpHandler)

app.listen(PORT, HOST, () => {
  console.error(`[wz-pdf-mcp] HTTP listening on ${HOST}:${PORT}`)
  console.error('[wz-pdf-mcp] sandbox configured')
})
