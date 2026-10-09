#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');
const serverPath = join(repoRoot, 'dist', 'server.js');
const runtime = process.env.CANVAS_RUNTIME || process.execPath;
const runtimeName = basename(runtime).toLowerCase();
const runtimeArgs = runtimeName.includes('bun') ? ['run', serverPath] : [serverPath];
const firstPort = Number(process.env.PORT || 34000 + Math.floor(Math.random() * 1500));
const fixtureRoot = mkdtempSync(join(tmpdir(), 'mcp excalidraw durable 状态-'));
const dataDirectory = join(fixtureRoot, 'canvas data');
const statePath = join(dataDirectory, 'canvas-state-v1.json');
const lockPath = join(dataDirectory, 'canvas-state.lock');
const blobDirectory = join(dataDirectory, 'blobs');

function serverUrl(port) {
  return `http://127.0.0.1:${port}`;
}

function spawnCanvas(canvasDataDirectory, port, preload) {
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    LOG_LEVEL: 'error',
  };
  if (canvasDataDirectory === null) delete env.EXCALIDRAW_DATA_DIR;
  else env.EXCALIDRAW_DATA_DIR = canvasDataDirectory;

  const args = preload ? ['--import', preload, ...runtimeArgs] : runtimeArgs;
  const child = spawn(runtime, args, {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  return { child, getOutput: () => output.trim(), url: serverUrl(port) };
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 2000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

async function waitForHealth(processInfo, timeoutMs = 7000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processInfo.child.exitCode !== null || processInfo.child.signalCode !== null) {
      throw new Error(`Canvas server exited before health check.\n${processInfo.getOutput()}`);
    }
    try {
      const response = await fetchWithTimeout(`${processInfo.url}/health`, {}, 500);
      if (response.ok) return response.json();
    } catch {
      // Listener may not be ready yet.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${processInfo.url}/health.\n${processInfo.getOutput()}`);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolve(null);
    }, timeoutMs);
    const onExit = (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    };
    child.once('exit', onExit);
  });
}

async function stopCanvas(processInfo) {
  if (!processInfo || processInfo.child.exitCode !== null || processInfo.child.signalCode !== null) return;
  processInfo.child.kill('SIGTERM');
  const exit = await waitForExit(processInfo.child, 3500);
  if (!exit) {
    processInfo.child.kill('SIGKILL');
    throw new Error(`Canvas server did not stop after SIGTERM.\n${processInfo.getOutput()}`);
  }
}

async function request(processInfo, path, init) {
  const response = await fetchWithTimeout(`${processInfo.url}${path}`, init);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON response from ${path}: ${text}`);
  }
  return { response, body };
}

function json(value) {
  return {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}

async function postJson(processInfo, path, body) {
  return request(processInfo, path, { method: 'POST', ...json(body) });
}

function listPathsRecursively(directory) {
  if (!existsSync(directory)) return [];
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    paths.push(path);
    if (entry.isDirectory()) paths.push(...listPathsRecursively(path));
  }
  return paths;
}

function assertNoTemporaryFiles(directory) {
  const temporary = listPathsRecursively(directory).filter(path => path.includes('.tmp-'));
  assert.deepEqual(temporary, [], `temporary durable-state files remained: ${temporary.join(', ')}`);
}

async function expectStartupFailure(directory, port, pattern, { expectLockRemoved = true } = {}) {
  const processInfo = spawnCanvas(directory, port);
  const exit = await waitForExit(processInfo.child, 3500);
  assert.ok(exit, `invalid durable state stayed running: ${processInfo.getOutput()}`);
  assert.notEqual(exit.code, 0);
  assert.match(processInfo.getOutput(), pattern);
  assert.equal(
    existsSync(join(directory, 'canvas-state.lock')),
    !expectLockRemoved,
    expectLockRemoved
      ? 'failed startup left an owned lock behind'
      : 'malformed pre-existing lock evidence was removed',
  );
}

let first;
let second;
let lockContender;
let writeFailure;
let memoryOnly;
let memoryOnlyRestart;
let publicationFailure;
let failureSocket;

try {
  process.env.EXPRESS_SERVER_URL = serverUrl(firstPort);
  process.env.ENABLE_CANVAS_SYNC = 'true';

  first = spawnCanvas(dataDirectory, firstPort);
  const firstHealth = await waitForHealth(first);
  assert.equal(firstHealth.durable_state_enabled, true);

  lockContender = spawnCanvas(dataDirectory, firstPort + 1);
  const lockExit = await waitForExit(lockContender.child, 3500);
  assert.ok(lockExit, 'second server acquired the same canvas data directory');
  assert.notEqual(lockExit.code, 0);
  assert.match(lockContender.getOutput(), /already owned by process/);
  lockContender = null;

  const initial = await request(first, '/api/elements');
  assert.equal(initial.response.status, 200);
  assert.deepEqual(initial.body.elements, []);

  const created = await postJson(first, '/api/elements', {
    id: 'baseline',
    type: 'rectangle',
    x: 10,
    y: 20,
    width: 120,
    height: 80,
  });
  assert.equal(created.response.status, 200);
  assert.equal(existsSync(statePath), true);

  const { importScene } = await import('../dist/core/scene-io.js');
  let rejected = false;
  try {
    await importScene({
      data: JSON.stringify({ elements: [{ id: 'bad', type: 'not-a-real-type', x: 0, y: 0 }] }),
      mode: 'replace',
    });
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, 'invalid replacement import was accepted');
  const afterRejectedReplace = await request(first, '/api/elements');
  assert.deepEqual(afterRejectedReplace.body.elements.map(element => element.id), ['baseline']);
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).elements.map(element => element.id), ['baseline']);

  const filePayload = {
    id: 'image-file',
    dataURL: 'data:image/png;base64,AA==',
    mimeType: 'image/png',
    created: 1,
  };
  await importScene({
    data: JSON.stringify({
      elements: [{
        id: 'replacement-image',
        type: 'image',
        x: 30,
        y: 40,
        width: 120,
        height: 80,
        fileId: 'image-file',
        status: 'saved',
        scale: [1, 1],
      }],
      files: { 'image-file': filePayload },
    }),
    mode: 'replace',
  });
  const afterReplace = await request(first, '/api/elements');
  assert.deepEqual(afterReplace.body.elements.map(element => element.id), ['replacement-image']);
  const afterImageImportFiles = await request(first, '/api/files');
  assert.equal(afterImageImportFiles.body.files['image-file'].dataURL, filePayload.dataURL);

  const beforeMissingImage = readFileSync(statePath, 'utf8');
  const missingImage = await postJson(first, '/api/elements', {
    id: 'missing-image',
    type: 'image',
    x: 1,
    y: 2,
    fileId: 'not-uploaded',
  });
  assert.equal(missingImage.response.status, 409);
  assert.match(missingImage.body.error, /upload the file before the element/);
  assert.equal(readFileSync(statePath, 'utf8'), beforeMissingImage);
  assert.deepEqual(
    (await request(first, '/api/elements')).body.elements.map(element => element.id),
    ['replacement-image'],
  );

  const snapshotWrite = await postJson(first, '/api/snapshots', { name: 'before-restart' });
  assert.equal(snapshotWrite.response.status, 200);
  const unorderedFiles = await postJson(first, '/api/files', [
    {
      id: 'z-file',
      dataURL: 'data:image/png;base64,Wg==',
      mimeType: 'image/png',
      created: 3,
    },
    {
      id: 'a-file',
      dataURL: 'data:image/png;base64,QQ==',
      mimeType: 'image/png',
      created: 4,
    },
  ]);
  assert.equal(unorderedFiles.response.status, 200);
  assert.equal((await postJson(first, '/api/snapshots', { name: 'z-snapshot' })).response.status, 200);
  assert.equal((await postJson(first, '/api/snapshots', { name: 'a-snapshot' })).response.status, 200);
  const beforeReferencedDelete = readFileSync(statePath, 'utf8');
  const referencedDelete = await request(first, '/api/files/image-file', { method: 'DELETE' });
  assert.equal(referencedDelete.response.status, 409);
  assert.match(referencedDelete.body.error, /references missing file image-file/);
  assert.equal(readFileSync(statePath, 'utf8'), beforeReferencedDelete);
  assert.equal((await request(first, '/api/files')).body.files['image-file'].dataURL, filePayload.dataURL);

  const rawCheckpoint = readFileSync(statePath, 'utf8');
  const checkpoint = JSON.parse(rawCheckpoint);
  assert.equal(checkpoint.schemaVersion, 1);
  assert.deepEqual(checkpoint.elements.map(element => element.id), ['replacement-image']);
  assert.deepEqual(checkpoint.files.map(file => file.id), ['a-file', 'image-file', 'z-file']);
  assert.deepEqual(
    checkpoint.snapshots.map(snapshot => snapshot.name),
    ['a-snapshot', 'before-restart', 'z-snapshot'],
  );
  assert.equal('stateId' in checkpoint, false);
  assert.equal('sceneRevision' in checkpoint, false);
  assert.equal('updatedAt' in checkpoint, false);
  assert.equal(rawCheckpoint.includes('dataURL'), false);
  assert.equal(rawCheckpoint.includes('data:image/png'), false);
  const imageRecord = checkpoint.files.find(file => file.id === 'image-file');
  assert.ok(imageRecord);
  assert.match(imageRecord.blob, /^blobs\/[a-f0-9]{64}\.blob$/);
  assert.match(imageRecord.sha256, /^[a-f0-9]{64}$/);
  const blobPath = join(dataDirectory, imageRecord.blob);
  assert.equal(readFileSync(blobPath, 'utf8'), filePayload.dataURL);
  const blobMtime = statSync(blobPath).mtimeMs;

  const beforeNoOpFileWrite = readFileSync(statePath, 'utf8');
  const repeatedFileWrite = await postJson(first, '/api/files', [filePayload]);
  assert.equal(repeatedFileWrite.response.status, 200);
  assert.equal(readFileSync(statePath, 'utf8'), beforeNoOpFileWrite, 'same logical state serialized differently');
  assert.equal(statSync(blobPath).mtimeMs, blobMtime, 'existing immutable blob was rewritten');

  const conflictingFileWrite = await postJson(first, '/api/files', [{
    ...filePayload,
    dataURL: 'data:image/png;base64,RElGRkVSRU5U',
    created: 999,
  }]);
  assert.equal(conflictingFileWrite.response.status, 409);
  assert.match(conflictingFileWrite.body.error, /immutable and cannot be replaced/);
  assert.equal(readFileSync(statePath, 'utf8'), beforeNoOpFileWrite, 'file conflict changed checkpoint');
  assert.equal(statSync(blobPath).mtimeMs, blobMtime, 'file conflict rewrote the original blob');

  const extra = await postJson(first, '/api/elements', {
    id: 'after-image', type: 'text', x: 50, y: 60, text: 'still one blob',
  });
  assert.equal(extra.response.status, 200);
  assert.equal(statSync(blobPath).mtimeMs, blobMtime, 'unrelated mutation rewrote the blob');
  assertNoTemporaryFiles(dataDirectory);

  const liveOwnerFiles = readdirSync(lockPath);
  assert.equal(statSync(lockPath).isDirectory(), true);
  assert.equal(liveOwnerFiles.length, 1);
  assert.match(liveOwnerFiles[0], /^owner-[0-9a-f-]{36}\.json$/);
  if (process.platform !== 'win32') {
    assert.equal(statSync(dataDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(statePath).mode & 0o777, 0o600);
    assert.equal(statSync(blobPath).mode & 0o777, 0o600);
    assert.equal(statSync(lockPath).mode & 0o777, 0o700);
    assert.equal(statSync(join(lockPath, liveOwnerFiles[0])).mode & 0o777, 0o600);
  }

  await stopCanvas(first);
  first = null;
  assert.equal(existsSync(lockPath), false, 'graceful shutdown left the data-directory lock behind');

  const missingBlobDirectory = join(fixtureRoot, 'missing blob');
  const corruptBlobDirectory = join(fixtureRoot, 'corrupt blob');
  const mimeMismatchDirectory = join(fixtureRoot, 'mime mismatch');
  cpSync(dataDirectory, missingBlobDirectory, { recursive: true });
  cpSync(dataDirectory, corruptBlobDirectory, { recursive: true });
  cpSync(dataDirectory, mimeMismatchDirectory, { recursive: true });

  second = spawnCanvas(dataDirectory, firstPort);
  await waitForHealth(second);
  const restoredElements = await request(second, '/api/elements');
  assert.deepEqual(restoredElements.body.elements.map(element => element.id), ['replacement-image', 'after-image']);
  const restoredFiles = await request(second, '/api/files');
  assert.deepEqual(Object.keys(restoredFiles.body.files), ['a-file', 'image-file', 'z-file']);
  assert.equal(restoredFiles.body.files['image-file'].dataURL, filePayload.dataURL);
  const restoredSnapshots = await request(second, '/api/snapshots');
  assert.deepEqual(
    restoredSnapshots.body.snapshots.map(snapshot => snapshot.name),
    ['a-snapshot', 'before-restart', 'z-snapshot'],
  );
  await stopCanvas(second);
  second = null;

  const missingState = JSON.parse(readFileSync(join(missingBlobDirectory, 'canvas-state-v1.json'), 'utf8'));
  unlinkSync(join(missingBlobDirectory, missingState.files[0].blob));
  await expectStartupFailure(missingBlobDirectory, firstPort + 2, /missing or unreadable/);

  const corruptState = JSON.parse(readFileSync(join(corruptBlobDirectory, 'canvas-state-v1.json'), 'utf8'));
  writeFileSync(
    join(corruptBlobDirectory, corruptState.files[0].blob),
    'corrupted',
  );
  await expectStartupFailure(corruptBlobDirectory, firstPort + 3, /failed blob integrity verification/);

  const mimeStatePath = join(mimeMismatchDirectory, 'canvas-state-v1.json');
  const mimeState = JSON.parse(readFileSync(mimeStatePath, 'utf8'));
  mimeState.files[0].mimeType = 'image/jpeg';
  writeFileSync(mimeStatePath, JSON.stringify(mimeState));
  await expectStartupFailure(mimeMismatchDirectory, firstPort + 14, /dataURL does not match its mimeType/);

  const writeFailureDirectory = join(fixtureRoot, 'write failure');
  writeFailure = spawnCanvas(writeFailureDirectory, firstPort + 4);
  await waitForHealth(writeFailure);
  failureSocket = new WebSocket(writeFailure.url.replace('http:', 'ws:'));
  await new Promise((resolve, reject) => {
    failureSocket.once('open', resolve);
    failureSocket.once('error', reject);
  });
  const failureMessages = [];
  failureSocket.on('message', data => failureMessages.push(JSON.parse(data.toString())));
  mkdirSync(join(writeFailureDirectory, 'canvas-state-v1.json'));
  const rejectedFile = await postJson(writeFailure, '/api/files', [{
    id: 'orphan-file',
    dataURL: 'data:image/png;base64,T1JQSEFO',
    mimeType: 'image/png',
    created: 2,
  }]);
  assert.equal(rejectedFile.response.status, 500);
  assert.match(rejectedFile.body.error, /^Failed to checkpoint canvas state: /);
  const rolledBackFiles = await request(writeFailure, '/api/files');
  assert.deepEqual(rolledBackFiles.body.files, {});
  assert.equal(readdirSync(join(writeFailureDirectory, 'blobs')).length, 1, 'blob was not durable before checkpoint publication');

  const rejectedElement = await postJson(writeFailure, '/api/elements', {
    id: 'must-roll-back', type: 'rectangle', x: 1, y: 2,
  });
  assert.equal(rejectedElement.response.status, 500);
  const rolledBackElements = await request(writeFailure, '/api/elements');
  assert.deepEqual(rolledBackElements.body.elements, []);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(failureMessages.some(message =>
    ['files_added', 'element_created', 'elements_batch_created', 'canvas_cleared'].includes(message.type)
  ), false, 'failed checkpoint broadcast a mutation');
  failureSocket.close();
  failureSocket = null;
  await stopCanvas(writeFailure);
  writeFailure = null;

  // A directory flush can fail after rename has already published the scene.
  // Keep memory consistent with that publication and fence future writes.
  if (process.platform !== 'win32' && !runtimeName.includes('bun')) {
    const publicationDirectory = join(fixtureRoot, 'publication failure');
    const publicationMarker = join(fixtureRoot, 'inject-directory-flush-failure');
    const preloadPath = join(fixtureRoot, 'fail-directory-flush.mjs');
    writeFileSync(preloadPath, `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import { join } from 'node:path';
      const original = fs.fsyncSync;
      fs.fsyncSync = function(fd) {
        if (fs.existsSync(${JSON.stringify(publicationMarker)}) &&
            fs.existsSync(join(process.env.EXCALIDRAW_DATA_DIR, 'canvas-state-v1.json')) &&
            fs.fstatSync(fd).isDirectory()) {
          throw Object.assign(new Error('injected directory flush failure'), { code: 'EIO' });
        }
        return original(fd);
      };
      syncBuiltinESMExports();
    `);
    publicationFailure = spawnCanvas(publicationDirectory, firstPort + 18, preloadPath);
    await waitForHealth(publicationFailure);
    failureSocket = new WebSocket(publicationFailure.url.replace('http:', 'ws:'));
    await new Promise((resolve, reject) => {
      failureSocket.once('open', resolve);
      failureSocket.once('error', reject);
    });
    const publicationMessages = [];
    failureSocket.on('message', data => publicationMessages.push(JSON.parse(data.toString())));
    writeFileSync(publicationMarker, 'inject');
    const publishedRequest = await postJson(publicationFailure, '/api/elements', {
      id: 'published-but-unacknowledged', type: 'rectangle', x: 1, y: 2,
    });
    assert.equal(publishedRequest.response.status, 500);
    unlinkSync(publicationMarker);
    const publishedState = JSON.parse(readFileSync(join(publicationDirectory, 'canvas-state-v1.json'), 'utf8'));
    const runningState = await request(publicationFailure, '/api/elements');
    assert.deepEqual(runningState.body.elements, publishedState.elements,
      'post-publication failure rolled back only memory');
    const fencedRequest = await postJson(publicationFailure, '/api/elements', {
      id: 'must-be-fenced', type: 'rectangle', x: 3, y: 4,
    });
    assert.equal(fencedRequest.response.status, 500, 'publication failure did not fence later mutations');
    assert.deepEqual(JSON.parse(readFileSync(join(publicationDirectory, 'canvas-state-v1.json'), 'utf8')), publishedState);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(publicationMessages.some(message => message.type === 'element_created'), false,
      'publication failure broadcast an unacknowledged mutation');
    failureSocket.close();
    failureSocket = null;
    await stopCanvas(publicationFailure);
    publicationFailure = spawnCanvas(publicationDirectory, firstPort + 18);
    await waitForHealth(publicationFailure);
    const recoveredPublication = await request(publicationFailure, '/api/elements');
    assert.deepEqual(recoveredPublication.body.elements, publishedState.elements);
    const resumedRequest = await postJson(publicationFailure, '/api/elements', {
      id: 'write-after-restart', type: 'rectangle', x: 5, y: 6,
    });
    assert.equal(resumedRequest.response.status, 200, 'restart did not restore writable state');
    await stopCanvas(publicationFailure);
    publicationFailure = null;
  }

  const invalidJsonDirectory = join(fixtureRoot, 'invalid json');
  mkdirSync(invalidJsonDirectory);
  writeFileSync(join(invalidJsonDirectory, 'canvas-state-v1.json'), '{');
  await expectStartupFailure(invalidJsonDirectory, firstPort + 5, /not valid JSON/);

  const unsupportedDirectory = join(fixtureRoot, 'unsupported schema');
  mkdirSync(unsupportedDirectory);
  writeFileSync(join(unsupportedDirectory, 'canvas-state-v1.json'), JSON.stringify({
    schemaVersion: 999, elements: [], files: [], snapshots: [],
  }));
  await expectStartupFailure(unsupportedDirectory, firstPort + 6, /Unsupported canvas state schema/);

  const unknownFieldDirectory = join(fixtureRoot, 'unknown schema field');
  mkdirSync(unknownFieldDirectory);
  writeFileSync(join(unknownFieldDirectory, 'canvas-state-v1.json'), JSON.stringify({
    schemaVersion: 1, elements: [], files: [], snapshots: [], extra: true,
  }));
  await expectStartupFailure(unknownFieldDirectory, firstPort + 7, /unsupported fields/);

  if (process.platform !== 'win32') {
    const brokenCheckpointDirectory = join(fixtureRoot, 'broken checkpoint symlink');
    mkdirSync(brokenCheckpointDirectory);
    symlinkSync(
      join(brokenCheckpointDirectory, 'missing-checkpoint.json'),
      join(brokenCheckpointDirectory, 'canvas-state-v1.json'),
    );
    await expectStartupFailure(
      brokenCheckpointDirectory,
      firstPort + 16,
      /not a regular file/,
    );
  }

  const invalidElementDirectory = join(fixtureRoot, 'invalid element');
  mkdirSync(invalidElementDirectory);
  writeFileSync(join(invalidElementDirectory, 'canvas-state-v1.json'), JSON.stringify({
    schemaVersion: 1,
    elements: [{ id: 'bad', type: 'rectangle', x: 'not-a-number', y: 0 }],
    files: [],
    snapshots: [],
  }));
  await expectStartupFailure(invalidElementDirectory, firstPort + 8, /invalid element/);

  const invalidElementTypeDirectory = join(fixtureRoot, 'invalid element type');
  mkdirSync(invalidElementTypeDirectory);
  writeFileSync(join(invalidElementTypeDirectory, 'canvas-state-v1.json'), JSON.stringify({
    schemaVersion: 1,
    elements: [{ id: 'bad-type', type: 42, x: 0, y: 0 }],
    files: [],
    snapshots: [],
  }));
  await expectStartupFailure(invalidElementTypeDirectory, firstPort + 9, /invalid element/);

  const duplicateElementDirectory = join(fixtureRoot, 'duplicate element');
  mkdirSync(duplicateElementDirectory);
  writeFileSync(join(duplicateElementDirectory, 'canvas-state-v1.json'), JSON.stringify({
    schemaVersion: 1,
    elements: [
      { id: 'same', type: 'rectangle', x: 0, y: 0 },
      { id: 'same', type: 'ellipse', x: 1, y: 1 },
    ],
    files: [],
    snapshots: [],
  }));
  await expectStartupFailure(duplicateElementDirectory, firstPort + 10, /duplicate element id/);

  const staleLockDirectory = join(fixtureRoot, 'stale lock');
  const staleLockPath = join(staleLockDirectory, 'canvas-state.lock');
  const staleLockToken = '00000000-0000-4000-8000-000000000003';
  mkdirSync(staleLockPath, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(staleLockPath, `owner-${staleLockToken}.json`),
    JSON.stringify({ pid: 2147483647, token: staleLockToken }),
    { mode: 0o600 },
  );
  const staleLockServer = spawnCanvas(staleLockDirectory, firstPort + 11);
  await waitForHealth(staleLockServer);
  await stopCanvas(staleLockServer);
  assert.equal(existsSync(staleLockPath), false);

  const emptyLockDirectory = join(fixtureRoot, 'empty lock shell');
  const emptyLockPath = join(emptyLockDirectory, 'canvas-state.lock');
  mkdirSync(emptyLockPath, { recursive: true, mode: 0o700 });
  const emptyLockServer = spawnCanvas(emptyLockDirectory, firstPort + 15);
  await waitForHealth(emptyLockServer);
  await stopCanvas(emptyLockServer);
  assert.equal(existsSync(emptyLockPath), false);

  const invalidLockDirectory = join(fixtureRoot, 'invalid lock');
  const invalidLockPath = join(invalidLockDirectory, 'canvas-state.lock');
  mkdirSync(invalidLockPath, { recursive: true });
  writeFileSync(join(invalidLockPath, 'unexpected-owner.json'), '{}');
  await expectStartupFailure(
    invalidLockDirectory,
    firstPort + 12,
    /invalid lock directory/,
    { expectLockRemoved: false },
  );

  // Native Excalidraw types outside the server's enum (a tab can sync them)
  // must checkpoint and restore like any other element.
  const nativeTypesDirectory = join(fixtureRoot, 'native element types');
  const nativeTypes = ['embeddable', 'iframe', 'magicframe'];
  let nativeTypesServer = spawnCanvas(nativeTypesDirectory, firstPort + 19);
  try {
    await waitForHealth(nativeTypesServer);
    const nativeSync = await postJson(nativeTypesServer, '/api/elements/sync', {
      elements: nativeTypes.map((type, index) => ({
        id: `native-${type}`, type, x: index * 400, y: 0, width: 300, height: 200,
      })),
    });
    assert.equal(nativeSync.response.status, 200, `native element sync failed: ${JSON.stringify(nativeSync.body)}`);
    await stopCanvas(nativeTypesServer);
    nativeTypesServer = spawnCanvas(nativeTypesDirectory, firstPort + 19);
    await waitForHealth(nativeTypesServer);
    const restoredNative = await request(nativeTypesServer, '/api/elements');
    assert.deepEqual(restoredNative.body.elements.map(element => element.type), nativeTypes);
  } finally {
    await stopCanvas(nativeTypesServer);
  }

  // Reuse the configured client port so importScene exercises the same
  // compiled canvas-client module against a memory-only server.
  memoryOnly = spawnCanvas(null, firstPort);
  const memoryHealth = await waitForHealth(memoryOnly);
  assert.equal('durable_state_enabled' in memoryHealth, false, 'opt-out changed the health response shape');
  await postJson(memoryOnly, '/api/elements', {
    id: 'ephemeral', type: 'rectangle', x: 0, y: 0,
  });
  const memoryFileA = await postJson(memoryOnly, '/api/files', [{
    id: 'mutable-in-memory', dataURL: 'data:image/png;base64,QQ==', mimeType: 'image/jpeg', created: 1,
  }]);
  assert.equal(memoryFileA.response.status, 200);
  const memoryFileB = await postJson(memoryOnly, '/api/files', [{
    id: 'mutable-in-memory', dataURL: 'data:image/png;base64,Qg==', created: 2,
  }]);
  assert.equal(memoryFileB.response.status, 200, 'in-memory mode changed existing file overwrite semantics');
  const memoryFiles = await request(memoryOnly, '/api/files');
  assert.equal(memoryFiles.body.files['mutable-in-memory'].dataURL, 'data:image/png;base64,Qg==');
  assert.equal(
    memoryFiles.body.files['mutable-in-memory'].mimeType,
    'image/png',
    'in-memory mode stopped applying the original default MIME on overwrite',
  );

  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    if (url.endsWith('/api/files') && init?.method === 'POST') {
      throw new Error('injected memory-only file upload failure');
    }
    return nativeFetch(input, init);
  };
  try {
    const memoryImport = await importScene({
      data: JSON.stringify({
        elements: [{
          id: 'memory-import-survives-file-failure',
          type: 'rectangle',
          x: 5,
          y: 6,
        }],
        files: {
          ignored: {
            id: 'ignored',
            dataURL: 'data:image/png;base64,SUdOT1JFRA==',
            mimeType: 'image/png',
            created: 3,
          },
        },
      }),
      mode: 'merge',
    });
    assert.equal(memoryImport.fileCount, 0);
  } finally {
    globalThis.fetch = nativeFetch;
  }
  const memoryElements = await request(memoryOnly, '/api/elements');
  assert.equal(
    memoryElements.body.elements.some(element => element.id === 'memory-import-survives-file-failure'),
    true,
    'in-memory import stopped preserving elements after a best-effort file upload failure',
  );
  await stopCanvas(memoryOnly);
  memoryOnly = null;

  memoryOnlyRestart = spawnCanvas(null, firstPort);
  await waitForHealth(memoryOnlyRestart);
  const blankAfterRestart = await request(memoryOnlyRestart, '/api/elements');
  assert.deepEqual(blankAfterRestart.body.elements, []);
  await stopCanvas(memoryOnlyRestart);
  memoryOnlyRestart = null;

  console.log(
    'Durable state check passed: opt-in default, atomic replace checkpointing, restart recovery, ' +
    'blob-first publication, immutable file identities, deterministic serialization, single-writer locking, ' +
    'rollback on write failure, no failure broadcasts, post-publication failure fencing, ' +
    'strict fail-closed loading, memory-only compatibility, files, snapshots, ' +
    'permissions, and no per-mutation image payload rewrite.'
  );
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
} finally {
  if (failureSocket) failureSocket.terminate();
  if (publicationFailure) await stopCanvas(publicationFailure).catch(error => console.error(error.message));
  if (memoryOnlyRestart) await stopCanvas(memoryOnlyRestart).catch(error => console.error(error.message));
  if (memoryOnly) await stopCanvas(memoryOnly).catch(error => console.error(error.message));
  if (writeFailure) await stopCanvas(writeFailure).catch(error => console.error(error.message));
  if (second) await stopCanvas(second).catch(error => console.error(error.message));
  if (lockContender) await stopCanvas(lockContender).catch(error => console.error(error.message));
  if (first) await stopCanvas(first).catch(error => console.error(error.message));
  rmSync(fixtureRoot, { recursive: true, force: true });
}
