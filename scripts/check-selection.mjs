#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const serverPath = join(repoRoot, 'dist', 'server.js');
const cliPath = join(repoRoot, 'dist', 'bin.js');
const port = 33456;

const server = spawn(process.execPath, [serverPath], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    LOG_LEVEL: 'error'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

const cleanup = () => {
  try {
    server.kill();
  } catch {}
};
process.on('exit', cleanup);

// Wait for server health
const deadline = Date.now() + 5000;
let healthy = false;
while (Date.now() < deadline) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    if (res.ok) {
      healthy = true;
      break;
    }
  } catch {}
  await new Promise(r => setTimeout(r, 100));
}
assert(healthy, 'Server failed to start in time');

try {
  // Test 1: Initial empty selection
  let res = await fetch(`http://127.0.0.1:${port}/api/selection`);
  let json = await res.json();
  assert.equal(json.success, true);
  assert.deepEqual(json.selectedElementIds, []);
  assert.equal(json.count, 0);

  // Test 2: Tab 1 connects and selects elements
  const ws1 = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise(r => ws1.on('open', r));
  ws1.send(JSON.stringify({ type: 'selection_updated', selectedElementIds: ['elem-1', 'elem-2'] }));
  await new Promise(r => setTimeout(r, 100));

  res = await fetch(`http://127.0.0.1:${port}/api/selection`);
  json = await res.json();
  assert.deepEqual(json.selectedElementIds, ['elem-1', 'elem-2']);
  assert.equal(json.count, 2);

  // Test 3: Tab 2 connects and becomes most recently active
  const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise(r => ws2.on('open', r));
  ws2.send(JSON.stringify({ type: 'selection_updated', selectedElementIds: ['elem-3'] }));
  await new Promise(r => setTimeout(r, 100));

  res = await fetch(`http://127.0.0.1:${port}/api/selection`);
  json = await res.json();
  assert.deepEqual(json.selectedElementIds, ['elem-3']);
  assert.equal(json.count, 1);

  // Test 4: Tab 2 closes -> Tab 1's selection is restored
  ws2.close();
  await new Promise(r => setTimeout(r, 100));

  res = await fetch(`http://127.0.0.1:${port}/api/selection`);
  json = await res.json();
  assert.deepEqual(json.selectedElementIds, ['elem-1', 'elem-2']);
  assert.equal(json.count, 2);

  // Test 5: CLI command `selection` output
  const cli = spawn(process.execPath, [cliPath, 'selection'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      EXPRESS_SERVER_URL: `http://127.0.0.1:${port}`,
      EXCALIDRAW_NO_AUTOSTART: '1'
    }
  });
  let cliOut = '';
  cli.stdout.on('data', d => cliOut += d.toString());
  await new Promise(r => cli.on('exit', r));
  const cliParsed = JSON.parse(cliOut.trim());
  assert.equal(cliParsed.success, true);
  assert.deepEqual(cliParsed.selectedElementIds, ['elem-1', 'elem-2']);
  assert.equal(cliParsed.count, 2);

  // Test 6: Tab 1 closes -> selection resets to empty
  ws1.close();
  await new Promise(r => setTimeout(r, 100));

  res = await fetch(`http://127.0.0.1:${port}/api/selection`);
  json = await res.json();
  assert.deepEqual(json.selectedElementIds, []);
  assert.equal(json.count, 0);

  console.log('ok - canvas selection synchronization & CLI command');
} finally {
  cleanup();
}
