#!/usr/bin/env node

// End-to-end checks for opt-in durable canvas state (EXCALIDRAW_DATA_DIR):
//   1. restart recovery (elements + image files + named snapshots)
//   2. single-writer lock contention on the data directory
//   3. failed checkpoint write -> 500 + in-memory rollback
//   4. corrupt checkpoint at startup -> refuse to start
//   5. unknown checkpoint version at startup -> refuse to start
//   6. unset EXCALIDRAW_DATA_DIR keeps the plain in-memory behavior

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const serverPath = join(repoRoot, 'dist', 'server.js');
const port = Number(process.env.PORT || 34500 + Math.floor(Math.random() * 400));
const baseUrl = `http://127.0.0.1:${port}`;

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
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}

function startServer(dataDir, extraEnv = {}) {
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(port),
      EXPRESS_SERVER_URL: baseUrl,
      ENABLE_CANVAS_SYNC: 'true',
      ...(dataDir ? { EXCALIDRAW_DATA_DIR: dataDir } : {}),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  return { child, getOutput: () => output };
}

async function waitForHealth(child, getOutput) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Canvas server exited before health check.\n${getOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/health`);
}

function waitForExit(child, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(true);
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
  const exited = await waitForExit(child, 5000);
  if (!exited) child.kill('SIGKILL');
}

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), 'excalidraw-persistence-'));
  const dataDir = join(workDir, 'data');
  try {
    // ── 1. restart recovery ─────────────────────────────────────────────
    {
      const { child, getOutput } = startServer(dataDir);
      await waitForHealth(child, getOutput);

      let r = await request('/api/elements', json({ type: 'rectangle', id: 'persist-1', x: 10, y: 10, width: 40, height: 20 }));
      assert(r.status === 200 && r.body.success, `element create failed: ${JSON.stringify(r.body)}`);

      r = await request('/api/files', json({ files: [{ id: 'img-1', dataURL: PNG_DATA_URL, mimeType: 'image/png' }] }));
      assert(r.status === 200 && r.body.success, `file upload failed: ${JSON.stringify(r.body)}`);

      r = await request('/api/snapshots', json({ name: 'checkpoint-a' }));
      assert(r.status === 200 && r.body.success, `snapshot save failed: ${JSON.stringify(r.body)}`);

      await stopChild(child);
    }
    {
      const { child, getOutput } = startServer(dataDir);
      await waitForHealth(child, getOutput);

      const r = await request('/api/elements');
      assert(r.body.count === 1, `expected 1 element after restart, got ${r.body.count}`);
      assert(r.body.elements[0]?.id === 'persist-1', 'restored element has wrong id');

      const files = await request('/api/files');
      assert(files.body.files?.['img-1']?.dataURL === PNG_DATA_URL, 'image file not restored byte-for-byte');

      const snaps = await request('/api/snapshots');
      assert(
        Array.isArray(snaps.body.snapshots) && snaps.body.snapshots.some((s) => s.name === 'checkpoint-a'),
        `snapshot not restored: ${JSON.stringify(snaps.body).slice(0, 200)}`
      );

      assert(existsSync(join(dataDir, 'files', 'img-1')), 'image payload not written as its own file');

      await stopChild(child);
      console.log('ok   restart recovery keeps elements, files, and snapshots');
    }

    // ── 2. single-writer lock ───────────────────────────────────────────
    {
      const a = startServer(dataDir);
      await waitForHealth(a.child, a.getOutput);
      const b = startServer(dataDir);
      const exited = await waitForExit(b.child, 8000);
      assert(exited, 'second server did not exit while data dir was locked');
      assert(b.child.exitCode === 1, `second server exit code ${b.child.exitCode}, expected 1`);
      assert(b.getOutput().includes('locked by canvas server'), `lock error not reported:\n${b.getOutput()}`);
      await stopChild(a.child);
      console.log('ok   second writer on a locked data dir refuses to start');
    }

    // ── 3. failed checkpoint write -> 500 + rollback ────────────────────
    {
      const { child, getOutput } = startServer(dataDir);
      await waitForHealth(child, getOutput);
      const before = (await request('/api/elements')).body.count;

      // Block checkpoint writes (the user cannot create the temp file), but
      // keep the last good scene.json readable so rollback has a source.
      chmodSync(dataDir, 0o555);
      let r;
      try {
        r = await request('/api/elements', json({ type: 'rectangle', id: 'should-vanish', x: 1, y: 1, width: 5, height: 5 }));
      } finally {
        chmodSync(dataDir, 0o755);
      }
      assert(r.status === 500, `mutation during failed checkpoint returned ${r.status}, expected 500`);
      const after = (await request('/api/elements')).body;
      assert(after.count === before, `in-memory state not rolled back: ${after.count} != ${before}`);
      assert(!after.elements.some((el) => el.id === 'should-vanish'), 'rolled-back element still present');

      await stopChild(child);
      console.log('ok   failed checkpoint rejects the mutation and rolls memory back');
    }

    // ── 4. corrupt checkpoint at startup ────────────────────────────────
    {
      writeFileSync(join(dataDir, 'scene.json'), '{"version":1,"elements":<garbage');
      const { child, getOutput } = startServer(dataDir);
      const exited = await waitForExit(child, 8000);
      assert(exited && child.exitCode === 1, `corrupt state did not refuse to start (exit ${child.exitCode})`);
      assert(getOutput().includes('Refusing to start'), `refusal not explained:\n${getOutput()}`);
      console.log('ok   corrupt checkpoint refuses to start');
    }

    // ── 5. unknown checkpoint version ───────────────────────────────────
    {
      writeFileSync(join(dataDir, 'scene.json'), JSON.stringify({ version: 99, elements: [], snapshots: [], files: [] }));
      const { child, getOutput } = startServer(dataDir);
      const exited = await waitForExit(child, 8000);
      assert(exited && child.exitCode === 1, `unknown version did not refuse to start (exit ${child.exitCode})`);
      assert(getOutput().includes('version'), 'version mismatch not explained');
      console.log('ok   unknown checkpoint version refuses to start');
    }

    // ── 6. default stays in-memory ──────────────────────────────────────
    {
      const { child, getOutput } = startServer(null);
      await waitForHealth(child, getOutput);
      const r = await request('/api/elements', json({ type: 'rectangle', id: 'memory-only', x: 0, y: 0, width: 5, height: 5 }));
      assert(r.status === 200 && r.body.success, 'in-memory mutation failed with durability off');
      await stopChild(child);
      console.log('ok   unset EXCALIDRAW_DATA_DIR keeps plain in-memory behavior');
    }

    console.log('All durable-state checks passed.');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
