#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { resolve } from 'path';
import dotenv from 'dotenv';
import logger from './utils/logger.js';

// Load environment variables
dotenv.config();

async function main() {
  try {
    // Parse command line arguments
    const options = {
      port: {
        type: 'string',
        short: 'p',
        default: process.env.PORT || '3000'
      },
      host: {
        type: 'string',
        short: 'h',
        default: process.env.HOST || 'localhost'
      },
      mode: {
        type: 'string',
        short: 'm',
        default: 'stdio'
      },
      debug: {
        type: 'boolean',
        short: 'd',
        default: false
      },
      help: {
        type: 'boolean',
        short: '?',
        default: false
      }
    };

    const { values, positionals } = parseArgs({
      options,
      allowPositionals: true,
      strict: false
    });

    // Show help if requested
    if (values.help) {
      showHelp();
      process.exit(0);
    }

    // Set debug mode if requested
    if (values.debug) {
      process.env.DEBUG = 'true';
      logger.level = 'debug';
      logger.debug('Debug mode enabled');
    }

    // Set the mode for server transport
    process.env.MCP_TRANSPORT_MODE = values.mode;

    // Set port and host
    process.env.PORT = values.port;
    process.env.HOST = values.host;

    // Import and run server
    const { default: runServer } = await import('./index.js');
    await runServer();

  } catch (error) {
    process.stderr.write(`Error starting MCP server: ${error}\n`);
    process.exit(1);
  }
}

function showHelp() {
  process.stderr.write(`
  Excalidraw MCP Server

  Usage: 
    npx excalidraw-mcp [options]

  Options:
    -p, --port <port>      Port to run the server on (default: 3000)
    -h, --host <host>      Host to bind the server to (default: localhost)
    -m, --mode <mode>      Transport mode: 'stdio' or 'http' (default: stdio)
    -d, --debug            Enable debug logging
    -?, --help             Show this help message

  Examples:
    npx excalidraw-mcp
    npx excalidraw-mcp --port 4000
    npx excalidraw-mcp --mode http
    npx excalidraw-mcp --debug
  \n`);
}

main().catch(error => {
  process.stderr.write(`Fatal error: ${error}\n`);
  process.exit(1);
}); 