#!/usr/bin/env node
// Manual fidelity check for the headless renderer (not part of CI: it needs
// Playwright's Chromium and fetches @excalidraw/excalidraw from esm.sh).
//
// Three comparisons against the Node + jsdom exporter, most to least lenient:
//   1. the canvas tab's export of the same seeded scene (the tab re-measures
//      text after fonts load, so bound-label positions may differ),
//   2. the Node render of whatever scene the tab synced back,
//   3. Excalidraw's exporter running in real Chromium on the identical
//      expanded elements — this one should be byte-identical apart from
//      zero-rotation centers on frame labels (text width estimate vs measured).
// Run after `npm run build`: node scripts/check-render-parity.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { mixedScene, pixelFile } from '../tests/browser/fixtures.mjs';
import { expandElementsForExport } from '../dist/core/expand-elements.js';
import { renderSvgWithExcalidraw } from '../dist/core/render/excalidraw-node/index.js';

const PORT = 51999;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ['dist/server.js'], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', LOG_LEVEL: 'error' },
  stdio: ['ignore', 'ignore', 'inherit']
});
const cleanup = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', cleanup);

async function waitHealthy() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('server did not become healthy');
}
const post = (p, body) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

const serverElements = mixedScene();
const expanded = expandElementsForExport(serverElements, { deterministic: true });
const files = { [pixelFile.id]: pixelFile };

let browser;
try {
  await waitHealthy();
  await post('/api/files', [pixelFile]);
  await post('/api/elements/sync', { elements: expanded, timestamp: Date.now() });

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(BASE);
  for (let i = 0; i < 40; i++) {
    const h = await fetch(`${BASE}/health`).then(r => r.json());
    if (h.websocket_clients > 0) break;
    await new Promise(r => setTimeout(r, 250));
  }
  await page.waitForTimeout(2000);

  const t0 = performance.now();
  const tab = await post('/api/export/image', { format: 'svg', background: true });
  const t1 = performance.now();
  if (!tab.success) throw new Error(`tab export failed: ${tab.error}`);

  const node = await renderSvgWithExcalidraw(expanded, files, { background: true, viewBackgroundColor: '#ffffff', dark: false, padding: 10 });

  // Root-tag attribute order differs between serializers (browser keeps
  // insertion order; jsdom emits the namespace first) — sort it.
  const sortRoot = s => s.replace(/^<svg([^>]*)>/, (_, attrs) => {
    const list = [...attrs.matchAll(/\s+([\w:-]+)="([^"]*)"/g)].map(m => `${m[1]}="${m[2]}"`);
    const seen = new Set(); const uniq = list.filter(a => { const k = a.split('=')[0]; if (seen.has(k)) return false; seen.add(k); return true; });
    return `<svg ${uniq.sort().join(' ')}>`;
  });
  const normalize = s => sortRoot(s
    .replace(/<style class="style-fonts">[\s\S]*?<\/style>/, '<style class="style-fonts"/>')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim());
  const a = normalize(tab.data), b = normalize(node);
  const stats = s => ({
    paths: (s.match(/<path/g) || []).length,
    texts: (s.match(/<text/g) || []).length,
    images: (s.match(/<image/g) || []).length,
    textContent: [...s.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]).join('|'),
    viewBox: (s.match(/viewBox="([^"]+)"/) || [])[1],
    size: (s.match(/width="([^"]+)" height="([^"]+)"/) || []).slice(1, 3).join('x')
  });
  console.log('tab export took   :', (t1 - t0).toFixed(0), 'ms (websocket path)');
  console.log('tab  stats        :', JSON.stringify(stats(a)));
  console.log('node stats        :', JSON.stringify(stats(b)));
  console.log('IDENTICAL after normalization:', a === b);
  if (a !== b) {
    let i = 0; while (i < a.length && a[i] === b[i]) i++;
    console.log(`first diff at ${i}/${a.length}`);
    console.log('  tab : ...' + a.slice(Math.max(0, i - 80), i + 160));
    console.log('  node: ...' + b.slice(Math.max(0, i - 80), i + 160));
  }
  // Second comparison: render exactly the scene the tab holds (it syncs its
  // re-measured elements back to the server), isolating exporter parity from
  // the tab's own text re-measurement.
  const synced = await fetch(`${BASE}/api/elements`).then(r => r.json());
  const tabElements = (synced.elements ?? synced).filter(e => !e.isDeleted);
  const fromTab = expandElementsForExport(tabElements, { deterministic: true });
  const node2 = await renderSvgWithExcalidraw(fromTab, files, { background: true, viewBackgroundColor: '#ffffff', dark: false, padding: 10 });
  const c = normalize(node2);
  console.log('tab-synced source :', tabElements[0]?.source, '| elements:', tabElements.length);
  console.log('IDENTICAL (node render of tab-synced scene vs tab export):', a === c);
  if (a !== c) {
    let i = 0; while (i < a.length && a[i] === c[i]) i++;
    console.log(`first diff at ${i}/${a.length}`);
    console.log('  tab : ...' + a.slice(Math.max(0, i - 80), i + 160));
    console.log('  node: ...' + c.slice(Math.max(0, i - 80), i + 160));
  }
  // Third comparison, the strict one: the same exporter code running in real
  // Chromium on the identical expanded elements (no editor in between).
  const browserSvg = await page.evaluate(async ({ elements, files }) => {
    const m = await import('https://esm.sh/@excalidraw/excalidraw@0.18.1?deps=react@18.3.1,react-dom@18.3.1');
    const restored = m.restoreElements(elements, null, { repairBindings: true });
    const svg = await m.exportToSvg({
      elements: restored,
      appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false, exportScale: 1, exportEmbedScene: false,
        frameRendering: { enabled: true, name: true, outline: true, clip: true } },
      files, exportPadding: 10, exportingFrame: null, skipInliningFonts: true, renderEmbeddables: false
    });
    return new XMLSerializer().serializeToString(svg);
  }, { elements: expanded, files }).catch(e => { console.error('browser exporter failed:', e.message); return null; });
  if (browserSvg) {
    const d = normalize(browserSvg);
    console.log('IDENTICAL (browser exporter vs node exporter, same input):', d === b);
    if (d !== b) {
      let i = 0; while (i < d.length && d[i] === b[i]) i++;
      console.log(`first diff at ${i}/${d.length}`);
      console.log('  browser: ...' + d.slice(Math.max(0, i - 80), i + 160));
      console.log('  node   : ...' + b.slice(Math.max(0, i - 80), i + 160));
    }
    fs.writeFileSync('/tmp/spike-render/browser-exporter.svg', browserSvg);
  }
  fs.writeFileSync('/tmp/spike-render/tab.svg', tab.data);
  fs.writeFileSync('/tmp/spike-render/tab-norm.svg', a);
  fs.writeFileSync('/tmp/spike-render/node-norm.svg', b);
} finally {
  if (browser) await browser.close();
  cleanup();
}
