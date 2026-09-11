#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const serverPath = join(repoRoot, 'dist', 'server.js');
const port = Number(process.env.PORT || 34000 + Math.floor(Math.random() * 1000));
const baseUrl = `http://127.0.0.1:${port}`;

process.env.EXPRESS_SERVER_URL = baseUrl;
process.env.ENABLE_CANVAS_SYNC = 'true';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  return { status: response.status, body };
}

function json(value) {
  return {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}

async function waitForHealth(child, getOutput) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Canvas server exited before health check.\n${getOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/health`);
}

function waitForExit(child, timeoutMs) {
  return new Promise(resolve => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  if (!await waitForExit(child, 1000)) child.kill('SIGKILL');
}

async function checkReplaceImportIsAtomic(importScene) {
  await request('/api/elements/clear', { method: 'DELETE' });
  await request('/api/elements', {
    method: 'POST',
    ...json({ id: 'baseline', type: 'rectangle', x: 10, y: 20 }),
  });

  let rejected = false;
  try {
    await importScene({
      data: JSON.stringify({
        elements: [{ id: 'bad', type: 'not-a-real-type', x: 0, y: 0 }],
      }),
      mode: 'replace',
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'replace import should reject an invalid scene');

  const afterInvalidImport = await request('/api/elements');
  assert(
    afterInvalidImport.body.elements?.some(element => element.id === 'baseline'),
    'failed replace import deleted the existing scene',
  );

  await importScene({
    data: JSON.stringify({
      elements: [{ id: 'replacement', type: 'ellipse', x: 30, y: 40 }],
    }),
    mode: 'replace',
  });
  const afterValidImport = await request('/api/elements');
  assert(afterValidImport.body.count === 1, 'successful replace import did not replace the scene');
  assert(afterValidImport.body.elements[0]?.id === 'replacement', 'replace import kept stale elements');
}

async function checkSyncValidatesBeforeUse() {
  for (const payload of [{}, { elements: null }]) {
    const result = await request('/api/elements/sync', {
      method: 'POST',
      ...json(payload),
    });
    assert(result.status === 400, `invalid sync returned HTTP ${result.status} instead of 400`);
    assert(
      result.body.error === 'Expected elements to be an array',
      `invalid sync returned an unexpected error: ${JSON.stringify(result.body.error)}`,
    );
  }
}

async function checkSnapshotsAreImmutable() {
  await request('/api/elements/clear', { method: 'DELETE' });
  await request('/api/elements/batch', {
    method: 'POST',
    ...json({ elements: [
      { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 },
      { id: 'b', type: 'rectangle', x: 300, y: 0, width: 100, height: 100 },
      { id: 'edge', type: 'arrow', x: 0, y: 0, start: { id: 'a' }, end: { id: 'b' } },
    ] }),
  });
  await request('/api/snapshots', { method: 'POST', ...json({ name: 'before-move' }) });
  const before = await request('/api/snapshots/before-move');

  await request('/api/elements/a', { method: 'PUT', ...json({ x: 100 }) });
  const after = await request('/api/snapshots/before-move');

  assert(
    JSON.stringify(before.body.snapshot) === JSON.stringify(after.body.snapshot),
    'saved snapshot changed after live bound-arrow geometry was updated',
  );
}

const child = spawn(process.execPath, [serverPath], {
  cwd: repoRoot,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'error' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', chunk => { output += chunk.toString(); });
child.stderr.on('data', chunk => { output += chunk.toString(); });

try {
  await waitForHealth(child, () => output.trim());
  const { importScene } = await import('../dist/core/scene-io.js');

  const checks = [
    ['replace imports are atomic', () => checkReplaceImportIsAtomic(importScene)],
    ['sync input is validated before use', checkSyncValidatesBeforeUse],
    ['saved snapshots are immutable', checkSnapshotsAreImmutable],
  ];

  let failed = 0;
  for (const [name, check] of checks) {
    try {
      await check();
      console.log(`ok - ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`not ok - ${name}`);
      console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failed > 0) process.exitCode = 1;
} finally {
  await stopChild(child);
}
