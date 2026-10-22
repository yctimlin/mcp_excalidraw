#!/usr/bin/env node
// Share-target checks — pure Node, no network, no canvas server.
// Run after `npm run build:server`: node scripts/check-share-url.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';

const failures = [];
async function check(name, fn) {
  try { await fn(); process.stdout.write(`ok   ${name}\n`); }
  catch (error) { failures.push(name); process.stdout.write(`FAIL ${name}\n     ${error.message}\n`); }
}

// Inverse of share-url.ts concatBuffers: [u32 version][u32 len][chunk]...
function splitBuffers(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  assert.equal(dv.getUint32(0), 1, 'concatBuffers version');
  const chunks = [];
  for (let off = 4; off < buf.byteLength;) {
    const len = dv.getUint32(off); off += 4;
    chunks.push(buf.subarray(off, off + len)); off += len;
  }
  return chunks;
}

function readConfig(env) {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    "const c = await import('./dist/core/config.js'); console.log(JSON.stringify([c.EXCALIDRAW_SHARE_UPLOAD_URL, c.EXCALIDRAW_SHARE_BASE_URL]))"],
    { env: { PATH: process.env.PATH, ...env } });
  return JSON.parse(out.toString());
}

await check('config: defaults to excalidraw.com', async () => {
  assert.deepEqual(readConfig({}), ['https://json.excalidraw.com/api/v2/post/', 'https://excalidraw.com']);
});

await check('config: blank values fall back to defaults, trailing slashes are trimmed', async () => {
  assert.deepEqual(readConfig({ EXCALIDRAW_SHARE_UPLOAD_URL: '  ', EXCALIDRAW_SHARE_BASE_URL: 'https://draw.example.com//' }),
    ['https://json.excalidraw.com/api/v2/post/', 'https://draw.example.com']);
});

// Fake excalidraw-json store
let received = null;
let status = 201;
const server = http.createServer((req, res) => {
  const body = [];
  req.on('data', (c) => body.push(c));
  req.on('end', () => {
    received = { method: req.method, url: req.url, body: Buffer.concat(body) };
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(status < 400 ? JSON.stringify({ id: 'abc123' }) : '{}');
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();

process.env.EXCALIDRAW_SHARE_UPLOAD_URL = `http://127.0.0.1:${port}/api/v2/scenes/`;
process.env.EXCALIDRAW_SHARE_BASE_URL = 'https://draw.example.com/';
const { exportToExcalidrawUrl } = await import('../dist/core/share-url.js');

const elements = [
  { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 },
  { id: 'b', type: 'ellipse', x: 200, y: 0, width: 80, height: 80 },
];

await check('share: uploads to the configured URL and builds the link from the configured base', async () => {
  const url = await exportToExcalidrawUrl(elements);
  assert.equal(received.method, 'POST');
  assert.equal(received.url, '/api/v2/scenes/');
  assert.match(url, /^https:\/\/draw\.example\.com\/#json=abc123,[A-Za-z0-9_-]+$/);

  // Decrypt what the server received with the key from the link
  const k = url.split(',')[1];
  const key = await webcrypto.subtle.importKey('jwk', { kty: 'oct', k, alg: 'A128GCM', ext: true }, { name: 'AES-GCM' }, false, ['decrypt']);
  const [meta, iv, ciphertext] = splitBuffers(new Uint8Array(received.body));
  assert.deepEqual(JSON.parse(Buffer.from(meta)), { version: 2, compression: 'pako@1', encryption: 'AES-GCM' });
  const plain = new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext));
  const [, data] = splitBuffers(new Uint8Array(zlib.inflateSync(plain)));
  const scene = JSON.parse(Buffer.from(data));
  assert.equal(scene.type, 'excalidraw');
  assert.deepEqual(scene.elements.map((e) => e.id).sort(), ['a', 'b']);
});

await check('share: upload errors name the configured host', async () => {
  status = 500;
  await assert.rejects(exportToExcalidrawUrl(elements), new RegExp(`Upload to 127\\.0\\.0\\.1:${port} failed: 500`));
});

server.close();
if (failures.length) { process.stdout.write(`\n${failures.length} check(s) failed\n`); process.exit(1); }
process.stdout.write('\nall share-url checks passed\n');
