#!/usr/bin/env node
// Headless renderer checks — pure Node, no browser, no canvas server.
// Run after `npm run build:server`: node scripts/check-render.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { mixedScene, pixelFile } from '../tests/browser/fixtures.mjs';
import { renderScene, RenderError } from '../dist/core/render/index.js';
import { expandElementsForExport } from '../dist/core/expand-elements.js';
import { prepareScene } from '../dist/core/render/excalidraw-node/index.js';
import { generateKeyBetween } from 'fractional-indexing';

const failures = [];
async function check(name, fn) {
  try { await fn(); process.stdout.write(`ok   ${name}\n`); }
  catch (error) { failures.push(name); process.stdout.write(`FAIL ${name}\n     ${error.message}\n`); }
}

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const serverElements = [
  ...mixedScene(),
  { id: 'virgil', type: 'text', x: 600, y: 320, text: 'Virgil here', fontSize: 20, fontFamily: 1 }
];
const scene = {
  elements: serverElements,
  files: { [pixelFile.id]: pixelFile }
};
const outDir = path.join(os.tmpdir(), 'excalidraw-check-render');
fs.mkdirSync(outDir, { recursive: true });

await check('svg: renders every element type in the fixture', async () => {
  const result = await renderScene(scene, { format: 'svg' });
  assert.ok(result.data.startsWith('<svg'), 'starts with <svg');
  assert.ok(!/<svg[^>]*xmlns="[^"]*"[^>]*xmlns=/.test(result.data), 'no duplicate xmlns attribute');
  for (const label of ['Bound label', 'Agent label', 'Hello inside frame', 'repro-frame', 'Virgil here']) {
    assert.ok(result.data.includes(label), `contains ${label}`);
  }
  assert.ok(result.data.includes('<image'), 'image element');
  assert.ok(result.data.includes('clip-path'), 'frame clip');
  assert.ok(result.data.includes('@font-face'), 'fonts embedded');
  assert.ok(result.data.includes('font-family: "Excalifont"'), 'Excalifont face');
  assert.ok(result.data.includes('font-family: "Virgil"'), 'Virgil face');
  assert.ok(result.width > 0 && result.height > 0, 'dimensions reported');
  fs.writeFileSync(path.join(outDir, 'scene.svg'), result.data);
});

await check('svg: deterministic for an unchanged scene', async () => {
  const a = await renderScene(scene, { format: 'svg' });
  const b = await renderScene(scene, { format: 'svg' });
  assert.equal(a.data, b.data);
});

await check('svg: embedFonts=false leaves the style block empty', async () => {
  const result = await renderScene(scene, { format: 'svg', embedFonts: false });
  assert.ok(!result.data.includes('@font-face'));
});

let base;
await check('png: valid file with the SVG dimensions', async () => {
  base = await renderScene(scene, { format: 'png' });
  const buffer = Buffer.from(base.data, 'base64');
  const dims = pngDimensions(buffer);
  const svg = await renderScene(scene, { format: 'svg' });
  assert.equal(dims.width, Math.round(svg.width));
  assert.equal(dims.height, Math.round(svg.height));
  assert.equal(base.width, dims.width);
  fs.writeFileSync(path.join(outDir, 'scene.png'), buffer);
});

await check('png: deterministic', async () => {
  const again = await renderScene(scene, { format: 'png' });
  assert.equal(again.data, base.data);
});

await check('png: scale 2 doubles the dimensions', async () => {
  const result = await renderScene(scene, { format: 'png', scale: 2 });
  const dims = pngDimensions(Buffer.from(result.data, 'base64'));
  // Scene sizes can end in .5px, so allow one pixel of rounding.
  assert.ok(Math.abs(dims.width - base.width * 2) <= 1, `width ${dims.width} vs ${base.width * 2}`);
  assert.ok(Math.abs(dims.height - base.height * 2) <= 1, `height ${dims.height} vs ${base.height * 2}`);
});

// Solid red 8x8 PNG, built here so the check needs no fixture file.
function solidPng() {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([0, ...Array(8).fill([255, 0, 0]).flat()])));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

await check('png: image elements are drawn (symbol/use inlined for resvg)', async () => {
  const image = { id: 'pic', type: 'image', x: 0, y: 0, width: 60, height: 60, fileId: 'red', status: 'saved', scale: [1, 1] };
  const red = { id: 'red', mimeType: 'image/png', created: 1, dataURL: `data:image/png;base64,${solidPng().toString('base64')}` };
  const withFile = await renderScene({ elements: [image], files: { red } }, { format: 'png' });
  const withoutFile = await renderScene({ elements: [image], files: {} }, { format: 'png' });
  assert.notEqual(withFile.data, withoutFile.data, 'image pixels missing from the PNG');
});

await check('png: dark mode and transparent background change the output', async () => {
  const dark = await renderScene(scene, { format: 'png', dark: true });
  const transparent = await renderScene(scene, { format: 'png', background: false });
  assert.notEqual(dark.data, base.data);
  assert.notEqual(transparent.data, base.data);
  fs.writeFileSync(path.join(outDir, 'scene-dark.png'), Buffer.from(dark.data, 'base64'));
});

await check('png: scale is clamped to the max dimension with a warning', async () => {
  process.env.EXCALIDRAW_RENDER_MAX_DIM = '600';
  try {
    const result = await renderScene(scene, { format: 'png', scale: 4 });
    const dims = pngDimensions(Buffer.from(result.data, 'base64'));
    assert.ok(Math.max(dims.width, dims.height) <= 600, `max dim ${Math.max(dims.width, dims.height)}`);
    assert.ok(result.warnings.some(w => w.includes('scale reduced')));
  } finally {
    delete process.env.EXCALIDRAW_RENDER_MAX_DIM;
  }
});

await check('elementIds: renders only the subset plus bound text', async () => {
  const result = await renderScene(scene, { format: 'svg', elementIds: ['shape'] });
  assert.ok(result.data.includes('Bound label'));
  assert.ok(!result.data.includes('Agent label'));
  assert.ok(!result.data.includes('<image'));
});

await check('frameId: clips to the frame and drops outside elements', async () => {
  const result = await renderScene(scene, { format: 'svg', frameId: 'frame-repro-1' });
  assert.ok(result.data.includes('Hello inside frame'));
  assert.ok(!result.data.includes('Bound label'));
});

await check('non-Latin text switches to system fonts with a warning', async () => {
  const cjk = {
    elements: [{ id: 'cjk', type: 'text', x: 0, y: 0, text: '中文標籤', fontSize: 20 }],
    files: {}
  };
  const result = await renderScene(cjk, { format: 'png' });
  assert.ok(result.warnings.some(w => w.includes('system fonts')));
});

await check('validation: bad scale, format, exclusive selectors, unknown ids', async () => {
  await assert.rejects(renderScene(scene, { format: 'png', scale: 9 }), RenderError);
  await assert.rejects(renderScene(scene, { format: 'gif' }), RenderError);
  await assert.rejects(renderScene(scene, { format: 'svg', elementIds: ['shape'], frameId: 'frame-repro-1' }), RenderError);
  await assert.rejects(renderScene(scene, { format: 'svg', elementIds: ['nope'] }), e => e instanceof RenderError && e.status === 404);
  await assert.rejects(renderScene(scene, { format: 'svg', frameId: 'shape' }), RenderError);
});

// More than 62 elements, so order keys must grow past one base-62 digit;
// the labels add bound text elements appended after every shape.
const exportSource = [
  ...Array.from({ length: 70 }, (_, i) => ({
    id: `box-${i}`, type: 'rectangle', x: (i % 10) * 200, y: Math.floor(i / 10) * 120,
    width: 160, height: 60, text: `Box ${i}`
  })),
  { id: 'note', type: 'text', x: 0, y: 900, text: 'free text\nsecond line', fontSize: 20 }
];

await check('export: order keys are valid and ascending in array order', async () => {
  const elements = expandElementsForExport(exportSource, { deterministic: true });
  const keys = elements.map(e => e.index);
  for (const key of keys) generateKeyBetween(key, null);  // throws "invalid order key"
  assert.deepEqual(keys, [...keys].sort(), 'keys sort as strings in array order');
  assert.equal(new Set(keys).size, keys.length, 'keys are unique');
});

await check('export: free text is left/top aligned, shape labels stay centred', async () => {
  const elements = expandElementsForExport(exportSource, { deterministic: true });
  const note = elements.find(e => e.id === 'note');
  assert.equal(note.textAlign, 'left');
  assert.equal(note.verticalAlign, 'top');
  const label = elements.find(e => e.id === 'box-0-label');
  assert.equal(label.textAlign, 'center');
});

await check('export: a re-exported scene renders from its file', async () => {
  const elements = expandElementsForExport(exportSource, { deterministic: true });
  const result = await renderScene({ elements, files: {} }, { format: 'svg' });
  assert.ok(result.data.includes('Box 69'));
});

// The canvas tab runs every server scene through prepareServerScene and syncs
// the result back, so repeated passes must not move anything (#116).
await check('scene prep: repeated passes keep text and arrow geometry', async () => {
  const source = [
    { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, label: { text: 'A' } },
    { id: 'b', type: 'rectangle', x: 300, y: 0, width: 100, height: 50 },
    { id: 'centre', type: 'text', x: 910, y: 100, text: 'Hello', textAlign: 'center', fontSize: 20 },
    { id: 'right', type: 'text', x: 910, y: 300, text: 'Mid', textAlign: 'right', verticalAlign: 'middle', fontSize: 20 },
    { id: 'up', type: 'arrow', x: 300, y: 300, width: 0, height: 40, points: [[0, 0], [0, -40]] },
    { id: 'link', type: 'arrow', x: 100, y: 25, width: 200, height: 0, points: [[0, 0], [200, 0]],
      start: { id: 'a' }, end: { id: 'b' }, label: { text: 'calls' } }
  ];
  const geometry = els => Object.fromEntries(els.map(e =>
    [e.containerId ? `label:${e.containerId}` : e.id, [e.x, e.y, e.width, e.height, JSON.stringify(e.points ?? null)]]));
  let elements = await prepareScene(source);
  const first = geometry(elements);
  for (const id of ['centre', 'right', 'up', 'link']) {
    const src = source.find(e => e.id === id);
    assert.deepEqual(first[id].slice(0, 2), [src.x, src.y], `${id} keeps the caller's x/y`);
  }
  assert.equal(first.up[3], 40, 'vertical arrow keeps its length');
  for (let i = 0; i < 3; i++) elements = await prepareScene(elements);
  assert.deepEqual(geometry(elements), first);
});

// A server update merged onto the tab's element carries the label shorthand
// and the bound text from the last conversion. Converting it again must
// replace that label, not add another one beside it.
await check('scene prep: merged label updates keep one bound label', async () => {
  const box = (x, text) => ({ id: 'box', type: 'rectangle', x, y: 0, width: 160, height: 70, label: { text } });
  let elements = await prepareScene([
    box(0, 'Hello'),
    { id: 'other', type: 'rectangle', x: 400, y: 0, width: 100, height: 70 },
    { id: 'edge', type: 'arrow', x: 160, y: 35, width: 240, height: 0, points: [[0, 0], [240, 0]],
      start: { id: 'box' }, end: { id: 'other' } }
  ]);
  for (const incoming of [box(10, 'Hello'), box(20, 'Hello'), box(30, 'Renamed')]) {
    // The tab's incremental merge (App.tsx): { ...local, ...incoming }
    elements = await prepareScene(elements.map(e => e.id === incoming.id ? { ...e, ...incoming } : e));
  }
  const labels = elements.filter(e => e.type === 'text');
  assert.deepEqual(labels.map(e => [e.id, e.containerId, e.text]), [['box-label', 'box', 'Renamed']]);
  const bindings = elements.find(e => e.id === 'box').boundElements.map(b => `${b.type}:${b.id}`).sort();
  assert.deepEqual(bindings, ['arrow:edge', 'text:box-label']);
});

await check('render time: warm render under 500 ms', async () => {
  const t0 = performance.now();
  await renderScene(scene, { format: 'png' });
  const ms = performance.now() - t0;
  assert.ok(ms < 500, `${ms.toFixed(0)} ms`);
});

process.stdout.write(`\noutputs: ${outDir}\n`);
if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write('\nAll headless renderer checks passed\n');
