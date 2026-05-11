import winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';
import { homedir } from 'os';

/**
 * Wählt einen plattformkompatiblen Default-Log-Pfad. MCP-Server werden im
 * Arbeitsverzeichnis ihres Aufrufers gestartet — ein relativer Pfad würde
 * dazu führen, dass Log-Dateien in fremden Projekt-/Cloud-Ordnern landen.
 *
 * Override via Env-Var LOG_FILE_PATH bleibt möglich.
 */
function defaultLogPath(): string {
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Logs', 'excalidraw-mcp.log');
  }
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local');
    return path.join(base, 'Excalidraw-MCP', 'excalidraw.log');
  }
  // Linux + andere POSIX: XDG-Konvention
  const xdgState = process.env.XDG_STATE_HOME || path.join(homedir(), '.local', 'state');
  return path.join(xdgState, 'excalidraw-mcp', 'excalidraw.log');
}

const LOG_FILE_PATH = process.env.LOG_FILE_PATH || defaultLogPath();

// Sicherstellen, dass das Log-Verzeichnis existiert — Winston wirft sonst beim Start.
try {
  fs.mkdirSync(path.dirname(LOG_FILE_PATH), { recursive: true });
} catch {
  // Wenn das fehlschlägt, fällt der File-Transport auf Default-Behavior zurück.
}

const logger: winston.Logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',

  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.uncolorize(),
    winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
    winston.format.printf(info => {
      const extra = info.metadata && Object.keys(info.metadata).length
        ? ` ${JSON.stringify(info.metadata)}`
        : '';
      return `${info.timestamp} [${info.level}] ${info.message}${extra}`
    })
  ),

  transports: [
    new winston.transports.Console({
      level: 'warn',                 // only warn+error to stderr
      stderrLevels: ['warn','error']
    }),

    new winston.transports.File({
      filename: LOG_FILE_PATH,    // all levels to file
      level: 'debug'
    })
  ]
});

export default logger;
