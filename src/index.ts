#!/usr/bin/env node

// Disable colors to prevent ANSI color codes from breaking JSON parsing
process.env.NODE_DISABLE_COLORS = '1';
process.env.NO_COLOR = '1';

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import logger from './utils/logger.js';
import { isMainModule } from './core/entry.js';
import { ENABLE_CANVAS_SYNC, EXCALIDRAW_NO_AUTOSTART } from './core/config.js';
import { excalidrawMcpServerFactory } from './core/mcp-server.js';
import { ensureCanvasReadyForMcpTool } from './core/canvas-state.js';

// Start server
async function runServer(): Promise<StdioServerHandle> {
  try {
    logger.info('Starting Excalidraw MCP server...');

    // `serveStdio` owns the era decision for the connection: an `initialize`
    // request pins a 2025-era instance, while a `server/discover` probe — or
    // any request carrying the 2026-07-28 `_meta` envelope, including a
    // `tools/call` sent without any handshake at all — pins a modern one.
    const handle = serveStdio(excalidrawMcpServerFactory, {
      onerror: error => {
        logger.warn('MCP stdio connection error:', error.message);
      }
    });

    logger.info('Excalidraw MCP server running on stdio');

    // Kick off auto-start after the stdio transport is connected so the MCP
    // handshake stays fast. Canvas-backed tools await the same promise before
    // touching HTTP, which avoids a first-tool race.
    if (ENABLE_CANVAS_SYNC && !EXCALIDRAW_NO_AUTOSTART) {
      void ensureCanvasReadyForMcpTool().catch(error => {
        logger.warn('Canvas auto-start failed:', (error as Error).message);
      });
    }

    process.stdin.resume();

    return handle;
  } catch (error) {
    logger.error('Error starting server:', error);
    process.stderr.write(`Failed to start MCP server: ${(error as Error).message}\n${(error as Error).stack}\n`);
    process.exit(1);
  }
}

// Add global error handlers
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception:', error);
  process.stderr.write(`UNCAUGHT EXCEPTION: ${error.message}\n${error.stack}\n`);
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled promise rejection:', reason);
  process.stderr.write(`UNHANDLED REJECTION: ${reason}\n`);
  setTimeout(() => process.exit(1), 1000);
});

// For testing and debugging purposes
if (process.env.DEBUG === 'true') {
  logger.debug('Debug mode enabled');
}

// Start the server if this file is run directly.
// npm/npx commonly invoke package bins through symlinks; isMainModule
// compares real paths so the stdio transport still starts from those
// standard install paths.
if (isMainModule(import.meta.url)) {
  runServer().catch(error => {
    logger.error('Failed to start server:', error);
    process.exit(1);
  });
}

export { createExcalidrawMcpServer, excalidrawMcpServerFactory } from './core/mcp-server.js';
export { runServer };
export default runServer;
