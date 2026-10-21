import dotenv from 'dotenv';

// Load environment variables once for every entry point (MCP server, CLI, canvas server)
dotenv.config();

// Express server configuration
export const EXPRESS_SERVER_URL = process.env.EXPRESS_SERVER_URL || 'http://127.0.0.1:3000';

// Where the user can open the live canvas (co-edit in real time with the agent)
// versus how to hand a copy to someone else. Advertised in the MCP server
// instructions and appended to results of tools that draw on the canvas, so
// agents always surface both links instead of leaving the user to find them.
export const CANVAS_LINKS_NOTE =
  `🖊️  Live canvas (open to watch and co-edit in real time): ${EXPRESS_SERVER_URL}\n` +
  '🔗 To share with others, call export_to_excalidraw_url for an excalidraw.com link.';

export const ENABLE_CANVAS_SYNC = process.env.ENABLE_CANVAS_SYNC !== 'false'; // Default to true

// Opt-out for auto-starting the canvas server from the CLI / MCP server
export const EXCALIDRAW_NO_AUTOSTART = process.env.EXCALIDRAW_NO_AUTOSTART === '1';

// Safe file path validation base directory (see sanitizeFilePath)
export const ALLOWED_EXPORT_DIR = process.env.EXCALIDRAW_EXPORT_DIR || process.cwd();
