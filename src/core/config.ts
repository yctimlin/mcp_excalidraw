import dotenv from 'dotenv';

// Load environment variables once for every entry point (MCP server, CLI, canvas server)
dotenv.config();

// Express server configuration
export const EXPRESS_SERVER_URL = process.env.EXPRESS_SERVER_URL || 'http://127.0.0.1:3000';
export const ENABLE_CANVAS_SYNC = process.env.ENABLE_CANVAS_SYNC !== 'false'; // Default to true

// Opt-out for auto-starting the canvas server from the CLI / MCP server
export const EXCALIDRAW_NO_AUTOSTART = process.env.EXCALIDRAW_NO_AUTOSTART === '1';

// Safe file path validation base directory (see sanitizeFilePath)
export const ALLOWED_EXPORT_DIR = process.env.EXCALIDRAW_EXPORT_DIR || process.cwd();

// Share target for `share` / `export_to_excalidraw_url`. Defaults to excalidraw.com;
// point both at a self-hosted Excalidraw whose storage backend speaks the
// excalidraw-json API (e.g. alswl/excalidraw-storage-backend) to keep links in-house.
export const EXCALIDRAW_SHARE_UPLOAD_URL =
  process.env.EXCALIDRAW_SHARE_UPLOAD_URL?.trim() || 'https://json.excalidraw.com/api/v2/post/';
export const EXCALIDRAW_SHARE_BASE_URL =
  (process.env.EXCALIDRAW_SHARE_BASE_URL?.trim() || 'https://excalidraw.com').replace(/\/+$/, '');
