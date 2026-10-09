import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import type { Stats } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import {
  elements,
  files,
  snapshots,
} from '../types.js';
import type {
  ExcalidrawFile,
  ServerElement,
  Snapshot,
} from '../types.js';

const STATE_SCHEMA_VERSION = 1 as const;
const STATE_FILE_NAME = 'canvas-state-v1.json';
const LOCK_FILE_NAME = 'canvas-state.lock';
const BLOB_DIRECTORY_NAME = 'blobs';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DATA_URL_MIME_PATTERN = /^data:([^;,]+)(?:;[^,]*)?,/i;

interface DurableFileRecordV1 {
  id: string;
  blob: string;
  sha256: string;
  mimeType: string;
  created: number;
}

interface DurableCanvasStateV1 {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  elements: ServerElement[];
  files: DurableFileRecordV1[];
  snapshots: Snapshot[];
}

export interface DurableStateStatus {
  enabled: boolean;
  loaded: boolean;
  path: string | null;
  elements: number;
  files: number;
  snapshots: number;
}

export class CanvasPersistenceError extends Error {
  override name = 'CanvasPersistenceError';

  constructor(cause: unknown) {
    // Surface the cause: this message is the route's error response.
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to checkpoint canvas state: ${detail}`, { cause });
  }
}

class CanvasCheckpointPublicationError extends Error {
  constructor(cause: unknown) {
    super('Checkpoint was published but its directory flush failed; restart required', { cause });
  }
}

export class CanvasFileImmutabilityError extends Error {
  override name = 'CanvasFileImmutabilityError';

  constructor(fileId: string) {
    super(`Canvas file ${fileId} is immutable and cannot be replaced`);
  }
}

export class CanvasFileReferenceError extends Error {
  override name = 'CanvasFileReferenceError';

  constructor(fileId: string) {
    super(`Canvas image references missing file ${fileId}; upload the file before the element`);
  }
}

interface OwnedLock {
  directory: string;
  ownerPath: string;
  token: string;
}

interface RuntimeStateBackup {
  elements: Map<string, ServerElement>;
  files: Map<string, ExcalidrawFile>;
  snapshots: Map<string, Snapshot>;
}

let initializedAuthority: string | null | undefined;
let ownedLock: OwnedLock | null = null;
let persistenceUnavailable = false;

interface KnownDurableBlob {
  digest: string;
  size: number;
  mtimeMs: number;
}

// Cache verified/published immutable blob metadata. Entries intentionally
// survive runtime deletion because orphan blobs are retained and a file id may
// never be rebound to different bytes later in the same authority. A cheap
// lstat on later mutations avoids re-reading unchanged base64 payloads while
// still detecting missing/replaced files during the running process.
const knownDurableBlobs = new Map<string, KnownDurableBlob>();

export function durableStateDirectory(): string | null {
  const configured = process.env.EXCALIDRAW_DATA_DIR?.trim();
  return configured ? resolve(configured) : null;
}

export function durableStatePath(): string | null {
  const directory = durableStateDirectory();
  return directory ? join(directory, STATE_FILE_NAME) : null;
}

export function durableStateEnabled(): boolean {
  return durableStateDirectory() !== null;
}

export function durableBlobDirectory(): string | null {
  const directory = durableStateDirectory();
  return directory ? join(directory, BLOB_DIRECTORY_NAME) : null;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function blobRelativePath(fileId: string): string {
  return `${BLOB_DIRECTORY_NAME}/${sha256(fileId)}.blob`;
}

function durableFileCacheKey(dataDirectory: string, fileId: string): string {
  return `${dataDirectory}\0${fileId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  if (actual.length !== canonicalExpected.length ||
      actual.some((key, index) => key !== canonicalExpected[index])) {
    throw new Error(`${label} has unsupported fields: ${actual.join(', ')}`);
  }
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function assertNonNegativeSafeInteger(
  value: unknown,
  label: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function canonicalize(value: unknown, stack = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Canvas state contains a non-finite number');
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (typeof value !== 'object') {
    throw new Error(`Canvas state contains an unsupported ${typeof value} value`);
  }
  if (stack.has(value)) {
    throw new Error('Canvas state contains a cyclic value');
  }

  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map(item => {
        const canonical = canonicalize(item, stack);
        return canonical === undefined ? null : canonical;
      });
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Canvas state contains a non-plain object');
    }

    // A null-prototype object preserves literal keys such as `__proto__`
    // instead of invoking Object.prototype setters during canonicalization.
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value).sort()) {
      const canonical = canonicalize((value as Record<string, unknown>)[key], stack);
      if (canonical !== undefined) {
        result[key] = canonical;
      }
    }
    return result;
  } finally {
    stack.delete(value);
  }
}

function stableStringify(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function fsyncDirectory(directory: string): void {
  if (process.platform === 'win32') return;
  const descriptor = openSync(directory, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function assertRealDirectory(directory: string, label: string): void {
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} is not a real directory: ${directory}`);
  }
}

function ensurePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertRealDirectory(directory, 'Canvas durable path');
}

function assertRegularFile(
  path: string,
  label: string,
): Stats {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} is not a regular file: ${path}`);
  }
  return metadata;
}

function rememberDurableBlob(
  cacheKey: string,
  digest: string,
  metadata: Stats,
): void {
  knownDurableBlobs.set(cacheKey, {
    digest,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
  });
}

function removeIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function validateRuntimeFile(file: ExcalidrawFile): void {
  if (!file || typeof file !== 'object') {
    throw new Error('Canvas files map contains a non-object value');
  }
  if (typeof file.id !== 'string' || file.id.length === 0) {
    throw new Error('Canvas file has an invalid id');
  }
  if (typeof file.dataURL !== 'string' || file.dataURL.length === 0) {
    throw new Error(`Canvas file ${file.id} has an invalid dataURL`);
  }
  if (typeof file.mimeType !== 'string' || file.mimeType.length === 0) {
    throw new Error(`Canvas file ${file.id} has an invalid mimeType`);
  }
  const encodedMimeType = DATA_URL_MIME_PATTERN.exec(file.dataURL)?.[1];
  if (!encodedMimeType || encodedMimeType.toLowerCase() !== file.mimeType.toLowerCase()) {
    throw new Error(`Canvas file ${file.id} dataURL does not match its mimeType`);
  }
  assertNonNegativeSafeInteger(file.created, `Canvas file ${file.id} created`);
}

function verifyBlob(
  path: string,
  dataDirectory: string,
  fileId: string,
  expectedDataURL: string,
  expectedDigest: string,
): void {
  const metadata = assertRegularFile(path, `Canvas file ${fileId}`);
  const actualDataURL = readFileSync(path, 'utf8');
  const actualDigest = sha256(actualDataURL);
  if (actualDigest !== expectedDigest || actualDataURL !== expectedDataURL) {
    throw new CanvasFileImmutabilityError(fileId);
  }
  rememberDurableBlob(
    durableFileCacheKey(dataDirectory, fileId),
    actualDigest,
    metadata,
  );
}

function ensureBlobDurable(file: ExcalidrawFile): DurableFileRecordV1 {
  validateRuntimeFile(file);

  const dataDirectory = durableStateDirectory();
  const blobDirectory = durableBlobDirectory();
  if (!dataDirectory || !blobDirectory) {
    throw new Error('Durable blob write requested while persistence is disabled');
  }

  ensurePrivateDirectory(blobDirectory);

  const relativePath = blobRelativePath(file.id);
  const finalPath = join(dataDirectory, relativePath);
  const contentDigest = sha256(file.dataURL);

  const cacheKey = durableFileCacheKey(dataDirectory, file.id);
  const knownBlob = knownDurableBlobs.get(cacheKey);
  if (knownBlob !== undefined) {
    if (knownBlob.digest !== contentDigest) {
      throw new CanvasFileImmutabilityError(file.id);
    }
    if (!existsSync(finalPath)) {
      throw new Error(`Canvas file ${file.id} is missing or unreadable`);
    }
    const metadata = assertRegularFile(finalPath, `Canvas file ${file.id}`);
    if (metadata.size !== knownBlob.size || metadata.mtimeMs !== knownBlob.mtimeMs) {
      verifyBlob(finalPath, dataDirectory, file.id, file.dataURL, contentDigest);
    }
  } else if (existsSync(finalPath)) {
    verifyBlob(finalPath, dataDirectory, file.id, file.dataURL, contentDigest);
  } else {
    const temporaryPath = join(
      blobDirectory,
      `.tmp-${process.pid}-${randomUUID()}.blob`,
    );
    let descriptor: number | null = null;
    try {
      descriptor = openSync(temporaryPath, 'wx', 0o600);
      writeFileSync(descriptor, file.dataURL, 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;

      try {
        // Hard-link publication gives us atomic no-clobber semantics. If a
        // competing process somehow published first, verify the immutable
        // target rather than overwriting it.
        linkSync(temporaryPath, finalPath);
        fsyncDirectory(blobDirectory);
        rememberDurableBlob(cacheKey, contentDigest, lstatSync(finalPath));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        verifyBlob(finalPath, dataDirectory, file.id, file.dataURL, contentDigest);
      }
    } finally {
      if (descriptor !== null) closeSync(descriptor);
      removeIfPresent(temporaryPath);
    }
  }

  return {
    id: file.id,
    blob: relativePath,
    sha256: contentDigest,
    mimeType: file.mimeType,
    created: file.created,
  };
}

function currentDurableState(): DurableCanvasStateV1 {
  const durableElements = Array.from(elements.entries()).map(([key, element]) => {
    if (element.id !== key) {
      throw new Error(`Canvas elements map key does not match element id: ${key}`);
    }
    return element;
  });
  validateElementArray(durableElements, 'Canvas runtime elements');

  const durableSnapshots = Array.from(snapshots.entries())
    .map(([key, snapshot]) => {
      if (snapshot.name !== key) {
        throw new Error(`Canvas snapshots map key does not match snapshot name: ${key}`);
      }
      return snapshot;
    })
    .sort((left, right) => compareStrings(left.name, right.name));
  validateSnapshotArray(durableSnapshots, 'Canvas runtime snapshots');

  const runtimeFileEntries = Array.from(files.entries())
    .sort(([left], [right]) => compareStrings(left, right));
  for (const [key, file] of runtimeFileEntries) {
    if (file.id !== key) {
      throw new Error(`Canvas files map key does not match file id: ${key}`);
    }
  }
  validateFileReferences(
    durableElements,
    durableSnapshots,
    new Set(runtimeFileEntries.map(([fileId]) => fileId)),
    'Canvas runtime',
  );
  const durableFiles = runtimeFileEntries.map(([, file]) => ensureBlobDurable(file));

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    // Map insertion order is the server's scene order and therefore must be
    // preserved. Canonicalization sorts object keys inside each element only.
    elements: durableElements,
    files: durableFiles,
    snapshots: durableSnapshots,
  };
}

function writeStateFile(statePath: string): void {
  const dataDirectory = durableStateDirectory();
  if (!dataDirectory) {
    throw new Error('Durable checkpoint requested while persistence is disabled');
  }

  const serialized = stableStringify(currentDurableState());
  const temporaryPath = join(
    dataDirectory,
    `.tmp-${process.pid}-${randomUUID()}.json`,
  );
  let descriptor: number | null = null;
  let published = false;

  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(descriptor, serialized, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, statePath);
    published = true;
    fsyncDirectory(dataDirectory);
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    removeIfPresent(temporaryPath);
    if (published) throw new CanvasCheckpointPublicationError(error);
    throw error;
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

interface LockOwner {
  pid: number;
  token: string;
  ownerPath: string;
}

function lockOwnerFileName(token: string): string {
  return `owner-${token}.json`;
}

function readLockOwner(lockDirectory: string): LockOwner | null {
  assertRealDirectory(lockDirectory, 'Canvas data-directory lock');
  let entries: string[];
  try {
    entries = readdirSync(lockDirectory);
  } catch (error) {
    throw new Error(
      `Canvas data directory has an unreadable lock directory: ${(error as Error).message}`,
    );
  }

  // An empty directory can exist only in the short interval between atomic
  // mkdir and owner-file publication (or after a crash in that interval).
  // Removing it is safe: a concurrent acquirer whose empty shell is removed
  // will fail its owner-file write and retry without ever claiming ownership.
  if (entries.length === 0) return null;
  if (entries.length !== 1) {
    throw new Error('Canvas data directory has an invalid lock directory');
  }

  const ownerFileName = entries[0]!;
  const match = /^owner-([0-9a-f-]{36})\.json$/.exec(ownerFileName);
  if (!match) {
    throw new Error('Canvas data directory has an invalid lock directory');
  }

  const tokenFromName = match[1]!;
  const ownerPath = join(lockDirectory, ownerFileName);
  assertRegularFile(ownerPath, 'Canvas data-directory lock owner');
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(ownerPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Canvas data directory has an unreadable lock owner: ${(error as Error).message}`,
    );
  }

  if (!isRecord(value)) {
    throw new Error('Canvas data directory has an invalid lock owner');
  }
  try {
    assertExactKeys(value, ['pid', 'token'], 'Canvas data directory lock owner');
  } catch {
    throw new Error('Canvas data directory has an invalid lock owner');
  }
  if (!Number.isSafeInteger(value.pid) || (value.pid as number) <= 0 ||
      typeof value.token !== 'string' || value.token !== tokenFromName) {
    throw new Error('Canvas data directory has an invalid lock owner');
  }

  return {
    pid: value.pid as number,
    token: value.token,
    ownerPath,
  };
}

function removeEmptyLockDirectory(lockDirectory: string): boolean {
  try {
    rmdirSync(lockDirectory);
    fsyncDirectory(dirname(lockDirectory));
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTEMPTY' || code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

export function acquireDurableStateLock(): void {
  const dataDirectory = durableStateDirectory();
  if (!dataDirectory) return;
  if (ownedLock) {
    throw new Error('Canvas data directory lock was already acquired in this process');
  }

  ensurePrivateDirectory(dataDirectory);
  const lockDirectory = join(dataDirectory, LOCK_FILE_NAME);
  const token = randomUUID();
  const ownerPath = join(lockDirectory, lockOwnerFileName(token));

  for (let attempt = 0; attempt < 12; attempt += 1) {
    let createdDirectory = false;
    let descriptor: number | null = null;

    try {
      // mkdir is the cross-platform, atomic no-clobber ownership primitive.
      // The token-specific owner filename makes stale reclamation race-safe:
      // a reclaimer can unlink only the owner it actually observed, never a
      // newer process's owner file created after the directory was recycled.
      mkdirSync(lockDirectory, { mode: 0o700 });
      createdDirectory = true;

      descriptor = openSync(ownerPath, 'wx', 0o600);
      writeFileSync(descriptor, stableStringify({ pid: process.pid, token }), 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;
      fsyncDirectory(lockDirectory);
      fsyncDirectory(dataDirectory);
      ownedLock = { directory: lockDirectory, ownerPath, token };
      return;
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor);
      const code = (error as NodeJS.ErrnoException).code;

      if (createdDirectory) {
        removeIfPresent(ownerPath);
        removeEmptyLockDirectory(lockDirectory);
        // A concurrent stale reclaimer may remove the just-created empty
        // directory before our owner file is published. Retrying is safe.
        if (code === 'ENOENT' || code === 'EEXIST') continue;
        throw error;
      }

      if (code !== 'EEXIST') throw error;

      const owner = readLockOwner(lockDirectory);
      if (owner === null) {
        removeEmptyLockDirectory(lockDirectory);
        continue;
      }
      if (processIsRunning(owner.pid)) {
        throw new Error(`Canvas data directory is already owned by process ${owner.pid}`);
      }

      // Delete exactly the stale token-specific owner observed above. If a
      // different process has already recycled the directory, this unlink
      // targets a path that no longer exists and cannot remove the new owner.
      try {
        unlinkSync(owner.ownerPath);
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw unlinkError;
        }
      }
      removeEmptyLockDirectory(lockDirectory);
    }
  }

  throw new Error('Failed to acquire canvas data directory lock');
}

export function releaseDurableStateLock(): void {
  if (!ownedLock) return;
  const lock = ownedLock;
  ownedLock = null;

  try {
    if (!existsSync(lock.directory)) return;
    const currentOwner = readLockOwner(lock.directory);
    if (currentOwner?.token !== lock.token || currentOwner.ownerPath !== lock.ownerPath) {
      return;
    }
    unlinkSync(lock.ownerPath);
    removeEmptyLockDirectory(lock.directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function validateElementArray(value: unknown, label: string): ServerElement[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  const seen = new Set<string>();
  for (const element of value) {
    if (!isRecord(element) ||
        typeof element.id !== 'string' || element.id.length === 0 ||
        // Any non-empty type: the sync endpoint accepts native Excalidraw
        // types the server enum omits (embeddable, iframe, magicframe), and a
        // checkpoint must be able to hold whatever the canvas accepted.
        typeof element.type !== 'string' || element.type.length === 0 ||
        typeof element.x !== 'number' || !Number.isFinite(element.x) ||
        typeof element.y !== 'number' || !Number.isFinite(element.y)) {
      throw new Error(`${label} contains an invalid element`);
    }
    if (seen.has(element.id)) {
      throw new Error(`${label} contains duplicate element id ${element.id}`);
    }
    seen.add(element.id);
  }
  return value as ServerElement[];
}

function referencedImageFileIds(
  value: readonly ServerElement[],
  label: string,
): Set<string> {
  const result = new Set<string>();
  for (const element of value) {
    if (element.type !== 'image' || element.isDeleted === true) continue;
    const fileId = (element as ServerElement & { fileId?: unknown }).fileId;
    if (typeof fileId !== 'string' || fileId.length === 0) {
      throw new Error(`${label} contains an image with an invalid fileId`);
    }
    result.add(fileId);
  }
  return result;
}

function validateFileReferences(
  sceneElements: readonly ServerElement[],
  sceneSnapshots: readonly Snapshot[],
  availableFileIds: ReadonlySet<string>,
  label: string,
): void {
  const referenced = referencedImageFileIds(sceneElements, `${label} elements`);
  for (const snapshot of sceneSnapshots) {
    for (const fileId of referencedImageFileIds(
      snapshot.elements,
      `${label} snapshot ${snapshot.name}`,
    )) {
      referenced.add(fileId);
    }
  }
  for (const fileId of referenced) {
    if (!availableFileIds.has(fileId)) {
      throw new CanvasFileReferenceError(fileId);
    }
  }
}

function parseFileRecord(value: unknown): DurableFileRecordV1 {
  if (!isRecord(value)) {
    throw new Error('Canvas state contains an invalid file record');
  }
  assertExactKeys(
    value,
    ['id', 'blob', 'sha256', 'mimeType', 'created'],
    'Canvas file record',
  );

  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error('Canvas file record has an invalid id');
  }
  if (typeof value.blob !== 'string' || value.blob !== blobRelativePath(value.id)) {
    throw new Error(`Canvas file ${value.id} has an invalid blob reference`);
  }
  if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) {
    throw new Error(`Canvas file ${value.id} has an invalid sha256`);
  }
  if (typeof value.mimeType !== 'string' || value.mimeType.length === 0) {
    throw new Error(`Canvas file ${value.id} has an invalid mimeType`);
  }
  assertNonNegativeSafeInteger(value.created, `Canvas file ${value.id} created`);

  return {
    id: value.id,
    blob: value.blob,
    sha256: value.sha256,
    mimeType: value.mimeType,
    created: value.created,
  };
}

function validateSnapshotArray(value: unknown, label: string): Snapshot[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  const seen = new Set<string>();
  return value.map((snapshot, index) => {
    if (!isRecord(snapshot)) {
      throw new Error(`${label} contains an invalid snapshot at index ${index}`);
    }
    assertExactKeys(snapshot, ['name', 'elements', 'createdAt'], 'Canvas snapshot');
    if (typeof snapshot.name !== 'string' || snapshot.name.length === 0 ||
        typeof snapshot.createdAt !== 'string' || snapshot.createdAt.length === 0) {
      throw new Error(`${label} contains an invalid snapshot at index ${index}`);
    }
    if (seen.has(snapshot.name)) {
      throw new Error(`${label} contains duplicate snapshot ${snapshot.name}`);
    }
    seen.add(snapshot.name);
    validateElementArray(snapshot.elements, `Canvas snapshot ${snapshot.name} elements`);
    return snapshot as unknown as Snapshot;
  });
}

function parseSnapshotArray(value: unknown): Snapshot[] {
  return validateSnapshotArray(value, 'Canvas state snapshots');
}

function parseDurableState(raw: string): DurableCanvasStateV1 {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Canvas state is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(value)) {
    throw new Error('Canvas state must be a JSON object');
  }
  assertExactKeys(
    value,
    ['schemaVersion', 'elements', 'files', 'snapshots'],
    'Canvas state',
  );
  if (value.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported canvas state schema: ${String(value.schemaVersion)}`);
  }
  if (!Array.isArray(value.files)) {
    throw new Error('Canvas state files must be an array');
  }

  const parsedFiles = value.files.map(parseFileRecord);
  const seenFileIds = new Set<string>();
  for (const file of parsedFiles) {
    if (seenFileIds.has(file.id)) {
      throw new Error(`Canvas state contains duplicate file id ${file.id}`);
    }
    seenFileIds.add(file.id);
  }

  const parsedElements = validateElementArray(value.elements, 'Canvas state elements');
  const parsedSnapshots = parseSnapshotArray(value.snapshots);
  validateFileReferences(
    parsedElements,
    parsedSnapshots,
    seenFileIds,
    'Canvas state',
  );

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    elements: parsedElements,
    files: parsedFiles,
    snapshots: parsedSnapshots,
  };
}

function hydrateFile(record: DurableFileRecordV1): ExcalidrawFile {
  const dataDirectory = durableStateDirectory();
  if (!dataDirectory) {
    throw new Error('Durable file load requested while persistence is disabled');
  }

  const blobPath = join(dataDirectory, record.blob);
  if (!existsSync(blobPath)) {
    throw new Error(`Canvas file ${record.id} is missing or unreadable`);
  }
  assertRegularFile(blobPath, `Canvas file ${record.id}`);
  let dataURL: string;
  try {
    dataURL = readFileSync(blobPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Canvas file ${record.id} is missing or unreadable: ${(error as Error).message}`,
    );
  }
  if (sha256(dataURL) !== record.sha256) {
    throw new Error(`Canvas file ${record.id} failed blob integrity verification`);
  }

  const hydrated: ExcalidrawFile = {
    id: record.id,
    dataURL,
    mimeType: record.mimeType,
    created: record.created,
  };
  validateRuntimeFile(hydrated);
  rememberDurableBlob(
    durableFileCacheKey(dataDirectory, record.id),
    record.sha256,
    lstatSync(blobPath),
  );
  return hydrated;
}

function replaceMap<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  target.clear();
  source.forEach((value, key) => target.set(key, value));
}

function captureRuntimeState(): RuntimeStateBackup {
  return {
    elements: structuredClone(elements) as Map<string, ServerElement>,
    // File payload strings are immutable; clone each record object without
    // duplicating every base64 payload on unrelated element mutations.
    files: new Map(
      Array.from(files, ([fileId, file]) => [fileId, { ...file }]),
    ) as Map<string, ExcalidrawFile>,
    snapshots: structuredClone(snapshots) as Map<string, Snapshot>,
  };
}

function restoreRuntimeState(backup: RuntimeStateBackup): void {
  replaceMap(elements, backup.elements);
  replaceMap(files, backup.files);
  replaceMap(snapshots, backup.snapshots);
}

function requireOwnedLock(): void {
  const dataDirectory = durableStateDirectory();
  if (dataDirectory && ownedLock?.directory !== join(dataDirectory, LOCK_FILE_NAME)) {
    throw new Error('Canvas durable state lock must be held before loading or checkpointing');
  }
}

function requireInitializedState(): void {
  const dataDirectory = durableStateDirectory();
  if (!dataDirectory ||
      ownedLock?.directory !== join(dataDirectory, LOCK_FILE_NAME) ||
      initializedAuthority !== dataDirectory) {
    throw new Error('Canvas durable state must be locked and loaded before mutations');
  }
}

export function commitCanvasMutation<T>(mutate: () => T): T {
  const statePath = durableStatePath();
  if (!statePath) return mutate();

  if (persistenceUnavailable) {
    throw new CanvasPersistenceError(new Error('Canvas persistence requires a restart after a publication failure'));
  }

  requireInitializedState();
  const backup = captureRuntimeState();

  let value: T;
  try {
    value = mutate();
  } catch (error) {
    restoreRuntimeState(backup);
    throw error;
  }

  try {
    // currentDurableState() publishes any new immutable blobs before the
    // checkpoint that references them. Before-publication failures restore the
    // runtime maps; already-durable unreferenced blobs are safe.
    writeStateFile(statePath);
  } catch (error) {
    if (error instanceof CanvasCheckpointPublicationError) {
      // rename already made this scene visible on disk. Rolling back only the
      // maps would make the running scene disagree with restart recovery. Keep
      // the published scene, reject this request, and fence further mutations
      // until an operator restarts and validates the store. No success or
      // broadcast escapes the caller's error path.
      persistenceUnavailable = true;
      throw new CanvasPersistenceError(error);
    }
    restoreRuntimeState(backup);
    if (error instanceof CanvasFileImmutabilityError ||
        error instanceof CanvasFileReferenceError) {
      throw error;
    }
    throw new CanvasPersistenceError(error);
  }

  return value;
}

export function loadDurableState(): DurableStateStatus {
  if (initializedAuthority !== undefined) {
    throw new Error('Canvas durable state was already loaded in this process');
  }

  const dataDirectory = durableStateDirectory();
  const statePath = durableStatePath();
  if (!statePath || !dataDirectory) {
    initializedAuthority = null;
    return {
      enabled: false,
      loaded: false,
      path: null,
      elements: elements.size,
      files: files.size,
      snapshots: snapshots.size,
    };
  }

  requireOwnedLock();
  let hasCheckpoint = true;
  try {
    assertRegularFile(statePath, 'Canvas state path');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      hasCheckpoint = false;
    } else {
      throw error;
    }
  }

  if (!hasCheckpoint) {
    // A configured directory with no checkpoint is a new empty authority.
    // Do not inherit module-level state prepared before the lock was acquired.
    elements.clear();
    files.clear();
    snapshots.clear();
    initializedAuthority = dataDirectory;
    return {
      enabled: true,
      loaded: false,
      path: statePath,
      elements: 0,
      files: 0,
      snapshots: 0,
    };
  }

  const state = parseDurableState(readFileSync(statePath, 'utf8'));
  const restoredElements = new Map(
    state.elements.map(element => [element.id, element]),
  );
  const restoredFiles = new Map(
    state.files.map(record => [record.id, hydrateFile(record)]),
  );
  const restoredSnapshots = new Map(
    state.snapshots.map(snapshot => [snapshot.name, snapshot]),
  );

  replaceMap(elements, restoredElements);
  replaceMap(files, restoredFiles);
  replaceMap(snapshots, restoredSnapshots);
  initializedAuthority = dataDirectory;

  return {
    enabled: true,
    loaded: true,
    path: statePath,
    elements: elements.size,
    files: files.size,
    snapshots: snapshots.size,
  };
}
