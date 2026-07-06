import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import logger from '../utils/logger.js';

/**
 * Platform-compatible state directory for runtime artifacts (pidfile),
 * mirroring the log-path convention in utils/logger.ts.
 */
function stateDir(): string {
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', 'excalidraw-canvas');
  }
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local');
    return path.join(base, 'Excalidraw-Canvas');
  }
  const xdgState = process.env.XDG_STATE_HOME || path.join(homedir(), '.local', 'state');
  return path.join(xdgState, 'excalidraw-canvas');
}

export function pidFilePath(port: number): string {
  return path.join(stateDir(), `server-${port}.pid`);
}

// Written by the canvas server once it is actually listening, so `stop` and
// stale-process checks work for both auto-spawned and manually started servers.
export function writePidFile(port: number, pid: number): void {
  try {
    const file = pidFilePath(port);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(pid), 'utf-8');
  } catch (error) {
    logger.warn('Failed to write canvas pidfile:', (error as Error).message);
  }
}

export function readPidFile(port: number): number | null {
  try {
    const raw = fs.readFileSync(pidFilePath(port), 'utf-8').trim();
    const pid = parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function removePidFile(port: number): void {
  try {
    fs.unlinkSync(pidFilePath(port));
  } catch { /* already gone */ }
}
