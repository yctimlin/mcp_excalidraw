import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import type { JsonSchemaType, McpRequestContext, McpServerFactory } from '@modelcontextprotocol/server';
import logger from '../utils/logger.js';
import { packageVersion } from './version.js';
import { tools } from './mcp-tools.js';
import { callExcalidrawTool } from './mcp-dispatch.js';

const SERVER_NAME = 'mcp-excalidraw-server';
const SERVER_DESCRIPTION =
  'Programmatic canvas toolkit for Excalidraw with file I/O, image export, and real-time sync';
const SERVER_VERSION = packageVersion();

// `tools/list` and `server/discover` are cacheable results on 2026-07-28
// (SEP-2549): both are derived from the static tool table in `mcp-tools.ts`, so
// a short shared TTL is safe. Canvas contents are never described by these
// results — element data only ever travels through `tools/call`, which is not
// a cacheable operation.
const STATIC_SURFACE_CACHE_HINT = { ttlMs: 300_000, cacheScope: 'public' as const };

/**
 * Builds a fresh MCP server instance exposing the Excalidraw toolkit.
 *
 * One instance serves exactly one serving unit (one stdio connection, or one
 * discarded `server/discover` probe), which is why nothing canvas-related is
 * stored on it — see `core/canvas-state.ts`. The same factory backs both
 * protocol eras, so the advertised tools and their behaviour are identical
 * whether the client opened with `initialize` (2025) or with the per-request
 * `_meta` envelope (2026-07-28).
 */
export function createExcalidrawMcpServer(ctx?: McpRequestContext): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      description: SERVER_DESCRIPTION
    },
    {
      capabilities: { tools: {} },
      cacheHints: {
        'tools/list': STATIC_SURFACE_CACHE_HINT,
        'server/discover': STATIC_SURFACE_CACHE_HINT
      }
    }
  );

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        ...(tool.description !== undefined ? { description: tool.description } : {}),
        // `Tool['inputSchema']` is the spec's open JSON value shape; the
        // validator wants a JSON Schema. The tool table above is the authority
        // for both, so reuse it verbatim rather than re-authoring the schemas.
        inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema as JsonSchemaType)
      },
      async (args: Record<string, unknown>) => callExcalidrawTool(tool.name, args)
    );
  }

  logger.debug('Built Excalidraw MCP server instance', {
    era: ctx?.era ?? 'unknown',
    toolCount: tools.length
  });

  return server;
}

/**
 * The factory handed to the SDK's serving entries (`serveStdio`). It is called
 * once per connection with the era the connection negotiated.
 */
export const excalidrawMcpServerFactory: McpServerFactory = ctx => createExcalidrawMcpServer(ctx);
