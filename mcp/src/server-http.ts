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
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'

import { tools, callTool } from './tools.js'

const PORT = Number(process.env.PORT ?? 5051)
const SANDBOX = process.env.MCP_SANDBOX_DIR
// Optional shared-secret. When set, every /mcp request must carry
// `Authorization: Bearer <token>`. Unset = open (LAN-only deployments).
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN

if (!SANDBOX) {
  console.error(
    '[wz-pdf-mcp] REFUSING TO START — MCP_SANDBOX_DIR is not set.\n' +
    '             Set it to a directory you trust the public to read/write,\n' +
    '             e.g. MCP_SANDBOX_DIR=/opt/wz-pdf-mcp/workspace',
  )
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
app.use(express.json({ limit: '50mb' }))  // PDFs can be sizeable when base64'd

// Health check for nginx / uptime monitoring (never requires auth).
app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, name: 'wz-pdf-mcp', sandbox: SANDBOX, auth: !!AUTH_TOKEN })
})

// Bearer-token gate on /mcp when MCP_AUTH_TOKEN is configured. Uses a
// length-aware constant-ish comparison to avoid trivial timing leaks.
function authorized(req: Request): boolean {
  if (!AUTH_TOKEN) return true
  const header = req.headers['authorization']
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const presented = header.slice('Bearer '.length)
  if (presented.length !== AUTH_TOKEN.length) return false
  let diff = 0
  for (let i = 0; i < presented.length; i++) {
    diff |= presented.charCodeAt(i) ^ AUTH_TOKEN.charCodeAt(i)
  }
  return diff === 0
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

app.listen(PORT, () => {
  console.error(`[wz-pdf-mcp] HTTP listening on :${PORT}`)
  console.error(`[wz-pdf-mcp] sandbox: ${SANDBOX}`)
})
