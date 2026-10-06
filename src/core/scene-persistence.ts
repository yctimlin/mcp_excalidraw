import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import type { ServerElement, ExcalidrawFile, Snapshot } from '../types.js';

// Opt-in durable canvas state (see discussion #102).
//
// When EXCALIDRAW_DATA_DIR is set, the canvas server checkpoints its whole
// state (elements, server-known image files, named snapshots) into that
// directory and restores it on the next start, so a restart — planned or
// crash — no longer loses the scene. When the variable is unset, behavior is
// unchanged: everything stays in memory only.
//
// Durability contract:
//   - a mutation is acknowledged only after its checkpoint is durably on
//     disk (temp file -> fsync -> atomic rename); a failed checkpoint rolls
//     the in-memory state back to the last good one, and the request fails
//     with 500
//   - startup is fail-closed: an unreadable, corrupt, or unknown-version
//     checkpoint refuses to start rather than silently discarding state
//   - one writer per data directory, enforced by a pid lock
//
// Layout:
//   <dataDir>/lock         single-writer lock ({ pid, startedAt })
//   <dataDir>/scene.json   versioned checkpoint referencing files by id
//   <dataDir>/files/<id>   image payloads, written once, never rewritten

export const SCENE_STATE_VERSION = 1;

export class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceError';
  }
}

interface FileRecord {
  id: string;
  mimeType: string;
  created: number;
}

interface PersistedScene {
  version: number;
  savedAt: string;
  elements: ServerElement[];
  snapshots: Snapshot[];
  files: FileRecord[];
}

interface LockRecord {
  pid: number;
  startedAt: string;
}

export function dataDir(): string | null {
  const dir = process.env.EXCALIDRAW_DATA_DIR;
  return dir && dir.trim() !== '' ? dir : null;
}

export function durabilityEnabled(): boolean {
  return dataDir() !== null;
}

function sceneFilePath(): string {
  return path.join(dataDir() as string, 'scene.json');
}

function filesDirPath(): string {
  return path.join(dataDir() as string, 'files');
}

function lockFilePath(): string {
  return path.join(dataDir() as string, 'lock');
}

function safeFileId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_');
}

// --- single-writer lock --------------------------------------------------

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function acquireDataDirLock(): void {
  const dir = dataDir() as string;
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(filesDirPath(), { recursive: true });

  try {
    const raw = fs.readFileSync(lockFilePath(), 'utf8');
    const lock = JSON.parse(raw) as LockRecord;
    if (!lock || typeof lock.pid !== 'number') throw new Error('bad lock shape');
    if (isProcessAlive(lock.pid)) {
      throw new PersistenceError(
        `Data directory ${dir} is locked by canvas server (pid ${lock.pid}). ` +
        'Only one writer per data directory is supported; stop the other server first.'
      );
    }
    logger.warn(`Taking over stale data-dir lock in ${dir} (pid ${lock.pid} is gone)`);
  } catch (error) {
    if (error instanceof PersistenceError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new PersistenceError(
        `Refusing to start: unreadable lock file at ${lockFilePath()} (${(error as Error).message}). ` +
        'Remove it manually if you are sure no other canvas server is using this data directory.'
      );
    }
  }

  const record: LockRecord = { pid: process.pid, startedAt: new Date().toISOString() };
  fs.writeFileSync(lockFilePath(), JSON.stringify(record, null, 2), 'utf8');
}

export function releaseDataDirLock(): void {
  if (!durabilityEnabled()) return;
  try {
    fs.rmSync(lockFilePath(), { force: true });
  } catch (error) {
    logger.warn('Failed to release data-dir lock:', (error as Error).message);
  }
}

// --- checkpoint I/O ------------------------------------------------------

function atomicWrite(file: string, contents: string | Buffer): void {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function parseSceneFile(raw: string, file: string): PersistedScene {
  let parsed: PersistedScene;
  try {
    parsed = JSON.parse(raw) as PersistedScene;
  } catch (error) {
    throw new PersistenceError(
      `Refusing to start: checkpoint ${file} is not valid JSON (${(error as Error).message}).`
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new PersistenceError(`Refusing to start: checkpoint ${file} has an unexpected shape.`);
  }
  if (parsed.version !== SCENE_STATE_VERSION) {
    throw new PersistenceError(
      `Refusing to start: checkpoint ${file} has version ${String(parsed.version)}, ` +
      `but this server only understands version ${SCENE_STATE_VERSION}.`
    );
  }
  if (!Array.isArray(parsed.elements) || !Array.isArray(parsed.snapshots) || !Array.isArray(parsed.files)) {
    throw new PersistenceError(
      `Refusing to start: checkpoint ${file} is missing elements/snapshots/files.`
    );
  }
  return parsed;
}

export interface RestoredScene {
  elements: ServerElement[];
  snapshots: Snapshot[];
  files: Array<ExcalidrawFile & { payload: Buffer }>;
}

// Reads the checkpoint and the referenced image files. Corrupt state throws
// PersistenceError — callers must refuse to start when that happens.
export function loadScene(): RestoredScene | null {
  const dir = dataDir() as string;
  const file = sceneFilePath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new PersistenceError(`Refusing to start: cannot read ${file} (${(error as Error).message}).`);
  }
  const scene = parseSceneFile(raw, file);

  const files: Array<ExcalidrawFile & { payload: Buffer }> = [];
  for (const record of scene.files) {
    if (!record || typeof record.id !== 'string') {
      throw new PersistenceError(`Refusing to start: bad file record in ${file}.`);
    }
    const payloadPath = path.join(filesDirPath(), safeFileId(record.id));
    let payload: Buffer;
    try {
      payload = fs.readFileSync(payloadPath);
    } catch (error) {
      throw new PersistenceError(
        `Refusing to start: checkpoint references image "${record.id}" but ${payloadPath} is missing ` +
        `(${(error as Error).message}).`
      );
    }
    files.push({
      id: record.id,
      mimeType: record.mimeType || 'image/png',
      created: record.created || Date.now(),
      dataURL: `data:${record.mimeType || 'image/png'};base64,${payload.toString('base64')}`,
      payload
    });
  }

  logger.info(
    `Restored checkpoint from ${dir}: ${scene.elements.length} elements, ` +
    `${scene.snapshots.length} snapshots, ${scene.files.length} files (saved ${scene.savedAt})`
  );
  return { elements: scene.elements, snapshots: scene.snapshots, files };
}

// Writes image payloads that are not on disk yet (each file exactly once),
// then atomically replaces scene.json. Throws on any failure; the in-memory
// state must then be rolled back to the last acknowledged checkpoint.
export function writeCheckpoint(state: {
  elements: Iterable<ServerElement>;
  snapshots: Iterable<Snapshot>;
  files: Map<string, ExcalidrawFile> | Record<string, ExcalidrawFile>;
}): void {
  const dir = dataDir() as string;
  const filesMap: Map<string, ExcalidrawFile> = state.files instanceof Map
    ? state.files
    : new Map(Object.entries(state.files));

  // Image payloads: written once, never rewritten (content for a given file
  // id is immutable in Excalidraw).
  const records: FileRecord[] = [];
  for (const [id, f] of filesMap) {
    const payloadPath = path.join(filesDirPath(), safeFileId(id));
    if (!fs.existsSync(payloadPath)) {
      const base64 = (f.dataURL || '').split(',')[1] ?? '';
      atomicWrite(payloadPath, Buffer.from(base64, 'base64'));
    }
    records.push({ id, mimeType: f.mimeType || 'image/png', created: f.created || Date.now() });
  }

  const scene: PersistedScene = {
    version: SCENE_STATE_VERSION,
    savedAt: new Date().toISOString(),
    elements: Array.from(state.elements),
    snapshots: Array.from(state.snapshots),
    files: records
  };
  atomicWrite(sceneFilePath(), JSON.stringify(scene));
}
