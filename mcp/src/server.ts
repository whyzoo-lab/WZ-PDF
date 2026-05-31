#!/usr/bin/env node
/**
 * WZ PDF — Model Context Protocol server
 *
 * Exposes PDF read/edit/page-ops operations to Claude (Desktop, web, Code).
 * Speaks JSON-RPC 2.0 over stdio per the MCP spec.
 *
 * Each tool is an atomic operation: it takes input file path(s) and an output
 * path, performs the work via pdf-lib / pdfjs, and writes the result. No
 * stateful "document handle" model — callers can chain tools naturally.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'

import { tools, callTool } from './tools.js'

async function main() {
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

  const transport = new StdioServerTransport()
  await server.connect(transport)
  // Server logs go to stderr so they don't pollute the JSON-RPC stdout.
  console.error('[wz-pdf-mcp] ready (stdio)')
}

main().catch(err => {
  console.error('[wz-pdf-mcp] fatal:', err)
  process.exit(1)
})
