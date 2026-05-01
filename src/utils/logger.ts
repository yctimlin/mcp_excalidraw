import winston from 'winston';
import os from 'os';
import path from 'path';

// Default to a temp-dir path outside the project to avoid persisting sensitive data in cwd
const defaultLogPath = path.join(os.tmpdir(), 'excalidraw-mcp.log');
const LOG_FILE_PATH = process.env.LOG_FILE_PATH || defaultLogPath;

// Redact large or sensitive payload fields before they reach the log file
const redactPayloads = winston.format((info) => {
  if (info.metadata && typeof info.metadata === 'object') {
    const meta = info.metadata as Record<string, unknown>;
    if ('data' in meta) meta.data = '[redacted]';
    if ('dataURL' in meta) meta.dataURL = '[redacted]';
  }
  return info;
});

const logger: winston.Logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',

  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.uncolorize(),
    winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
    redactPayloads(),
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
