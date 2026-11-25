#!/usr/bin/env node
// Headless Mermaid conversion: the canvas server converts in Node, so no
// browser tab is needed. Also checks that a connected WebSocket client (a stand-in
// for a canvas tab) receives the converted elements exactly once.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const port = Number(process.env.PORT || 35000 + Math.floor(Math.random() * 1000));
const baseUrl = `http://127.0.0.1:${port}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

const post = (path, value) => request(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value),
});

const clear = () => request('/api/elements/clear', { method: 'DELETE' });

async function waitForHealth(child, getOutput) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Canvas server exited before health check.\n${getOutput()}`);
    }
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/health`);
}

function runCli(args, input) {
  return new Promise(resolve => {
    const cli = spawn(process.execPath, [join(repoRoot, 'dist', 'bin.js'), ...args], {
      cwd: repoRoot,
      env: { ...process.env, EXPRESS_SERVER_URL: baseUrl, EXCALIDRAW_NO_AUTOSTART: '1', LOG_LEVEL: 'error' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    cli.stdout.on('data', chunk => { stdout += chunk; });
    cli.stderr.on('data', chunk => { stderr += chunk; });
    cli.on('close', code => resolve({ code, stdout, stderr }));
    cli.stdin.end(input ?? '');
  });
}

const DIAGRAMS = {
  flowchart: 'flowchart TD\n  subgraph Lane[Backend]\n    A[Start] --> B{Valid?}\n  end\n  B -->|yes| C[Save]\n  B -->|no| A',
  sequence: 'sequenceDiagram\n  participant A as Alice\n  participant B as Bob\n  A->>B: Hello Bob\n  B-->>A: Hi Alice',
  state: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: start\n  Running --> [*]: done',
  class: 'classDiagram\n  Animal <|-- Dog\n  Animal : +name',
  er: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places',
};

const NATIVE_TYPES = new Set(['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'text', 'frame', 'image']);

function checkNativeElements(elements, label) {
  assert(elements.length > 0, `${label}: no elements`);
  const ids = new Set();
  for (const element of elements) {
    assert(typeof element.id === 'string' && !ids.has(element.id), `${label}: missing or duplicate id`);
    ids.add(element.id);
    assert(NATIVE_TYPES.has(element.type), `${label}: unexpected type ${element.type}`);
    assert(Number.isFinite(element.x) && Number.isFinite(element.y), `${label}: bad coordinates on ${element.id}`);
    if (element.type === 'text') {
      assert(typeof element.text === 'string' && element.text.length > 0, `${label}: empty text ${element.id}`);
      assert(element.width > 0 && element.height > 0, `${label}: unmeasured text ${element.id}`);
    }
    if (element.containerId) assert(ids.has(element.containerId) || elements.some(e => e.id === element.containerId),
      `${label}: label points at a missing container`);
  }
}

async function checkHeadlessDiagram(name, definition) {
  await clear();
  const health = await request('/health');
  assert(health.body.websocket_clients === 0, 'test requires zero connected tabs');

  const result = await post('/api/elements/from-mermaid', { mermaidDiagram: definition });
  assert(result.status === 200 && result.body.success, `${name}: conversion failed: ${JSON.stringify(result.body)}`);
  assert(result.body.count > 0, `${name}: converted nothing`);

  const scene = await request('/api/elements');
  assert(scene.body.count === result.body.count, `${name}: scene count does not match response`);
  checkNativeElements(scene.body.elements, name);
  const labelled = scene.body.elements.filter(e => e.type === 'text').map(e => e.text).join(' ');
  const expectedText = { flowchart: 'Valid', sequence: 'Hello Bob', state: 'Running', class: 'Animal', er: 'CUSTOMER' }[name];
  assert(labelled.includes(expectedText), `${name}: expected label "${expectedText}" in "${labelled}"`);

  // Elements must render headlessly
  const svg = await post('/api/export/image', { format: 'svg', renderer: 'node' });
  assert(svg.status === 200 && svg.body.renderer === 'node', `${name}: headless SVG render failed: ${JSON.stringify(svg.body).slice(0, 200)}`);
  assert(String(svg.body.data).includes('<svg'), `${name}: render returned no SVG`);
  const png = await post('/api/export/image', { format: 'png', renderer: 'node' });
  assert(png.status === 200 && png.body.width > 0 && png.body.height > 0, `${name}: headless PNG render failed`);
}

async function checkMerge() {
  await clear();
  await post('/api/elements', { id: 'existing', type: 'rectangle', x: 0, y: 0, width: 50, height: 50 });
  const first = await post('/api/elements/from-mermaid', { mermaidDiagram: 'flowchart LR\n  A[One] --> B[Two]' });
  const second = await post('/api/elements/from-mermaid', { mermaidDiagram: 'flowchart LR\n  A[One] --> B[Two]' });
  assert(first.body.success && second.body.success, 'repeat conversion failed');
  const scene = await request('/api/elements');
  assert(scene.body.elements.some(e => e.id === 'existing'), 'conversion removed existing elements');
  assert(scene.body.count === 1 + first.body.count + second.body.count, 'conversion did not merge additively');
  assert(new Set(scene.body.elements.map(e => e.id)).size === scene.body.count, 'repeat conversion produced duplicate ids');
  const indices = scene.body.elements.map(e => e.index).filter(index => index !== undefined && index !== null);
  assert(new Set(indices).size === indices.length, `repeat conversion produced colliding fractional indices: ${JSON.stringify(indices)}`);
}

async function checkImageFallback() {
  await clear();
  // Diagram types without native conversion come back as an SVG image + file
  const result = await post('/api/elements/from-mermaid', { mermaidDiagram: 'pie title Pets\n  "Dogs" : 3\n  "Cats" : 2' });
  assert(result.body.success, `pie conversion failed: ${JSON.stringify(result.body)}`);
  const scene = await request('/api/elements');
  const images = scene.body.elements.filter(e => e.type === 'image');
  if (images.length === 0) return; // converted natively in this version
  const filesResponse = await request('/api/files');
  assert(images.every(image => filesResponse.body.files?.[image.fileId]), 'image element has no stored file');
  const render = await post('/api/export/image', { format: 'svg', renderer: 'node' });
  assert(render.status === 200, 'image fallback did not render');
}

async function checkErrors() {
  const empty = await post('/api/elements/from-mermaid', {});
  assert(empty.status === 400, 'missing diagram should be rejected');
  const badConfig = await post('/api/elements/from-mermaid', { mermaidDiagram: 'flowchart TD\n  A-->B', config: 'nope' });
  assert(badConfig.status === 400, 'non-object config should be rejected');
  const garbage = await post('/api/elements/from-mermaid', { mermaidDiagram: 'this is not mermaid at all' });
  assert(garbage.status === 400 && garbage.body.success === false, 'invalid Mermaid should be a 400');
}

async function checkConnectedTab() {
  await clear();
  const messages = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.on('message', data => messages.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await new Promise(resolve => setTimeout(resolve, 200));
  messages.length = 0;

  const result = await post('/api/elements/from-mermaid', { mermaidDiagram: DIAGRAMS.flowchart });
  await new Promise(resolve => setTimeout(resolve, 300));
  ws.close();

  assert(result.body.success, 'conversion with a connected tab failed');
  assert(!messages.some(m => m.type === 'mermaid_convert'), 'server still delegates conversion to the tab');
  const batches = messages.filter(m => m.type === 'elements_batch_created');
  assert(batches.length === 1, `expected one elements_batch_created, got ${batches.length}`);
  assert(batches[0].elements.length === result.body.count, 'tab received a different element set than the server stored');
  const texts = batches[0].elements.filter(e => e.type === 'text');
  const labelKeys = texts.map(e => `${e.containerId ?? e.id}:${e.text}`);
  assert(new Set(labelKeys).size === labelKeys.length, 'duplicate labels sent to the tab');
}

async function checkCli() {
  await clear();
  const run = await runCli(['mermaid', '-'], DIAGRAMS.state);
  assert(run.code === 0, `mermaid CLI exited ${run.code} with no tab open: ${run.stderr}`);
  const out = JSON.parse(run.stdout);
  assert(out.success && out.count > 0, `unexpected CLI output: ${run.stdout}`);
  const scene = await request('/api/elements');
  assert(scene.body.count === out.count, 'CLI conversion did not reach the scene');
}

async function checkMcpTool() {
  await clear();
  const { callExcalidrawTool } = await import('../dist/core/mcp-dispatch.js');
  const result = await callExcalidrawTool('create_from_mermaid', { mermaidDiagram: DIAGRAMS.sequence });
  const body = JSON.parse(result.content[0].text);
  assert(body.success && body.count > 0, `unexpected MCP result: ${result.content[0].text}`);
  assert(!/browser|open the canvas/i.test(result.content[0].text), 'MCP result still tells the user to open a tab');
}

process.env.EXPRESS_SERVER_URL = baseUrl;
process.env.ENABLE_CANVAS_SYNC = 'true';

const child = spawn(process.execPath, [join(repoRoot, 'dist', 'server.js')], {
  cwd: repoRoot,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'error' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', chunk => { output += chunk.toString(); });
child.stderr.on('data', chunk => { output += chunk.toString(); });

try {
  await waitForHealth(child, () => output.trim());
  const checks = [
    ...Object.entries(DIAGRAMS).map(([name, definition]) =>
      [`headless ${name} converts and renders with no tab`, () => checkHeadlessDiagram(name, definition)]),
    ['conversions merge into the scene with unique ids', checkMerge],
    ['image-fallback diagrams store their files', checkImageFallback],
    ['invalid input is rejected', checkErrors],
    ['connected tab receives the converted elements once', checkConnectedTab],
    ['mermaid CLI works with no tab open', checkCli],
    ['create_from_mermaid MCP tool works with no tab open', checkMcpTool],
  ];
  for (const [name, check] of checks) {
    await check();
    console.log(`ok - ${name}`);
  }
  console.log('Headless Mermaid checks passed.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (output.trim()) console.error(`--- server output ---\n${output.trim()}`);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
}
