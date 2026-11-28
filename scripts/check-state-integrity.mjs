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

async function checkBoundArrowsKeepWaypoints() {
  await request('/api/elements/clear', { method: 'DELETE' });
  const from = { id: 'from', type: 'rectangle', x: 100, y: 100, width: 160, height: 44 };
  const to = { id: 'to', type: 'rectangle', x: 600, y: 400, width: 160, height: 44 };
  // Out of the right edge of `from`, across, down, and into the left edge of `to`.
  const given = [[0, 0], [120, 0], [120, 300], [340, 300]];
  const bends = [[380, 122], [380, 422]];
  await request('/api/elements/batch', {
    method: 'POST',
    ...json({ elements: [
      from,
      to,
      { id: 'routed', type: 'arrow', x: 260, y: 122, points: given, start: { id: 'from' }, end: { id: 'to' } },
      { id: 'plain', type: 'arrow', x: 0, y: 0, start: { id: 'from' }, end: { id: 'to' } },
      { id: 'two', type: 'arrow', x: 0, y: 0, points: [[0, 0], [50, 50]], start: { id: 'from' }, end: { id: 'to' } },
    ] }),
  });
  const byId = async () => new Map((await request('/api/elements')).body.elements.map(el => [el.id, el]));
  const absolute = el => el.points.map(([px, py]) => [el.x + px, el.y + py]);
  const same = (a, b) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
  // How far a point lies outside a box: 0 inside it, and no more than the binding gap at an anchored end.
  const outside = (pt, box) => Math.hypot(
    Math.max(box.x - pt[0], 0, pt[0] - (box.x + box.width)),
    Math.max(box.y - pt[1], 0, pt[1] - (box.y + box.height)),
  );
  const anchored = (pt, box) => outside(pt, box) > 0 && outside(pt, box) <= 8.01;

  let stored = await byId();
  const routed = stored.get('routed');
  assert(
    routed.points.length === 4,
    `a bound arrow created with 4 points was stored with ${routed.points.length}: ${JSON.stringify(routed.points)}`,
  );
  let path = absolute(routed);
  assert(
    same(path[1], bends[0]) && same(path[2], bends[1]),
    `the caller's waypoints moved: ${JSON.stringify(path)}`,
  );
  assert(
    anchored(path[0], from) && anchored(path[3], to),
    `the ends of a routed bound arrow are not at its shapes' edges: ${JSON.stringify(path)}`,
  );

  // A bound arrow with no waypoints routes edge to edge, exactly as it always did.
  const plain = stored.get('plain');
  const two = stored.get('two');
  assert(plain.points.length === 2 && two.points.length === 2, 'a plain bound arrow gained or lost points');
  assert(
    JSON.stringify([plain.x, plain.y, plain.points]) === JSON.stringify([two.x, two.y, two.points]),
    'two points and no points no longer route the same way',
  );
  assert(
    anchored(absolute(plain)[0], from) && anchored(absolute(plain)[1], to),
    `a plain bound arrow is not anchored at its shapes' edges: ${JSON.stringify(absolute(plain))}`,
  );

  // The single-element create path.
  await request('/api/elements', {
    method: 'POST',
    ...json({ id: 'single', type: 'arrow', x: 260, y: 122, points: given, start: { id: 'from' }, end: { id: 'to' } }),
  });
  assert((await byId()).get('single').points.length === 4, 'creating one bound arrow dropped its waypoints');

  // Moving a shape re-anchors that end and leaves the waypoints where the caller put them.
  await request('/api/elements/to', { method: 'PUT', ...json({ y: 500 }) });
  stored = await byId();
  path = absolute(stored.get('routed'));
  assert(path.length === 4, `moving a bound shape flattened a routed arrow to ${path.length} points`);
  assert(same(path[1], bends[0]) && same(path[2], bends[1]), `moving a bound shape moved the waypoints: ${JSON.stringify(path)}`);
  assert(anchored(path[3], { ...to, y: 500 }), `the arrow did not follow the shape that moved: ${JSON.stringify(path)}`);
  assert(anchored(path[0], from), 'the end bound to the shape that stayed came loose');

  // An update that sets points keeps them, as it did before.
  await request('/api/elements/plain', { method: 'PUT', ...json({ points: given }) });
  assert((await byId()).get('plain').points.length === 4, 'an update with waypoints dropped them');
}

function runCli(args) {
  return new Promise(resolve => {
    const cli = spawn(process.execPath, [join(repoRoot, 'dist', 'bin.js'), ...args], {
      cwd: repoRoot,
      env: { ...process.env, EXPRESS_SERVER_URL: baseUrl, EXCALIDRAW_NO_AUTOSTART: '1', LOG_LEVEL: 'error' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    cli.stdout.on('data', chunk => { out += chunk.toString(); });
    cli.stderr.on('data', chunk => { out += chunk.toString(); });
    cli.on('exit', code => resolve({ code, out }));
  });
}

async function sceneIds() {
  const { body } = await request('/api/elements');
  return body.elements.map(element => element.id).sort();
}

// A browser-synced scene with a native frame, saved as a snapshot, then the
// canvas changed. Restoring must bring the frame and its child back.
async function seedFrameSnapshot(name) {
  await request('/api/elements/clear', { method: 'DELETE' });
  await request('/api/elements/sync', {
    method: 'POST',
    ...json({ elements: [
      { id: 'zone', type: 'frame', x: 0, y: 0, width: 400, height: 300, name: 'Zone' },
      { id: 'inside', type: 'rectangle', x: 20, y: 20, width: 100, height: 50, frameId: 'zone' },
    ] }),
  });
  await request('/api/snapshots', { method: 'POST', ...json({ name }) });
  await request('/api/elements/clear', { method: 'DELETE' });
  await request('/api/elements', { method: 'POST', ...json({ id: 'later', type: 'ellipse', x: 0, y: 0 }) });
}

// A snapshot holding a type the batch schema rejects must leave the canvas as is.
async function seedUnsupportedSnapshot(name) {
  await request('/api/elements/clear', { method: 'DELETE' });
  await request('/api/elements/sync', {
    method: 'POST',
    ...json({ elements: [{ id: 'web', type: 'embeddable', x: 0, y: 0, width: 300, height: 200 }] }),
  });
  await request('/api/snapshots', { method: 'POST', ...json({ name }) });
  await request('/api/elements/clear', { method: 'DELETE' });
  await request('/api/elements', { method: 'POST', ...json({ id: 'keep', type: 'rectangle', x: 0, y: 0 }) });
}

async function checkCliSnapshotRestore() {
  await seedFrameSnapshot('cli-frame');
  const restored = await runCli(['snapshot', 'restore', 'cli-frame']);
  assert(restored.code === 0, `restore of a frame snapshot failed: ${restored.out.trim()}`);
  assert(JSON.stringify(await sceneIds()) === '["inside","zone"]', 'frame snapshot did not restore exactly');
  const { body } = await request('/api/elements/inside');
  assert(body.element?.frameId === 'zone', 'restored child lost its frameId');

  await seedUnsupportedSnapshot('cli-bad');
  const rejected = await runCli(['snapshot', 'restore', 'cli-bad']);
  assert(rejected.code !== 0, 'restore of an unsupported snapshot reported success');
  assert(JSON.stringify(await sceneIds()) === '["keep"]', 'rejected restore changed the canvas');
}

async function checkMcpSnapshotRestore(callTool) {
  await seedFrameSnapshot('mcp-frame');
  const restored = await callTool('restore_snapshot', { name: 'mcp-frame' });
  assert(!restored.isError, `restore of a frame snapshot failed: ${JSON.stringify(restored.content)}`);
  assert(JSON.stringify(await sceneIds()) === '["inside","zone"]', 'frame snapshot did not restore exactly');

  await seedUnsupportedSnapshot('mcp-bad');
  const rejected = await callTool('restore_snapshot', { name: 'mcp-bad' });
  assert(rejected.isError, 'restore of an unsupported snapshot reported success');
  assert(JSON.stringify(await sceneIds()) === '["keep"]', 'rejected restore changed the canvas');
}

async function checkMcpTypedFilters(callTool) {
  await request('/api/elements/clear', { method: 'DELETE' });
  const seeded = await request('/api/elements/batch', {
    method: 'POST',
    ...json({ elements: [
      { id: '123', type: 'rectangle', x: 100, y: 20, width: 80, locked: true, opacity: 0 },
      { id: 'unlocked', type: 'rectangle', x: 200, y: 20, width: 80, locked: false, opacity: 100 },
      { id: 'outside', type: 'rectangle', x: 500, y: 20, width: 80, locked: true, opacity: 0 },
      { id: 'ellipse', type: 'ellipse', x: 100, y: 20, width: 80, locked: true, opacity: 0 },
    ] }),
  });
  assert(seeded.status === 200, `failed to seed query elements: ${JSON.stringify(seeded.body)}`);

  const cases = [
    [{ filter: { locked: true } }, ['123', 'ellipse', 'outside']],
    [{ filter: { locked: false } }, ['unlocked']],
    [{ filter: { x: 100 } }, ['123', 'ellipse']],
    [{ filter: { opacity: 0 } }, ['123', 'ellipse', 'outside']],
    [{ filter: { id: '123' } }, ['123']],
    [{ filter: { id: 123 } }, []],
    [{ filter: { locked: 'true' } }, []],
    [{ filter: { missing: true } }, []],
    [{ type: 'rectangle', bbox: { x_min: 0, x_max: 300 }, filter: { locked: true, width: 80 } }, ['123']],
    [{ type: 'rectangle', bbox: { x_min: 0, x_max: 300 } }, ['123', 'unlocked']],
    [{ filter: {} }, ['123', 'ellipse', 'outside', 'unlocked']],
  ];
  for (const [args, expected] of cases) {
    const result = await callTool('query_elements', args);
    assert(!result.isError, `query failed: ${JSON.stringify(result.content)}`);
    const ids = JSON.parse(result.content[0].text).map(element => element.id).sort();
    assert(JSON.stringify(ids) === JSON.stringify(expected),
      `query ${JSON.stringify(args)} returned ${JSON.stringify(ids)}, expected ${JSON.stringify(expected)}`);
  }
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
  const { callExcalidrawTool } = await import('../dist/core/mcp-dispatch.js');

  const checks = [
    ['MCP queries preserve filter value types', () => checkMcpTypedFilters(callExcalidrawTool)],
    ['replace imports are atomic', () => checkReplaceImportIsAtomic(importScene)],
    ['sync input is validated before use', checkSyncValidatesBeforeUse],
    ['saved snapshots are immutable', checkSnapshotsAreImmutable],
    ['bound arrows keep the waypoints they were given', checkBoundArrowsKeepWaypoints],
    ['CLI snapshot restore is atomic and keeps frames', checkCliSnapshotRestore],
    ['MCP snapshot restore is atomic and keeps frames', () => checkMcpSnapshotRestore(callExcalidrawTool)],
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
