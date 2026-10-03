#!/usr/bin/env node
// Bundle Excalidraw's exporter for Node: dist/render/excalidraw-node.mjs.
//
// Why a bundle: @excalidraw/excalidraw's dist is browser-oriented ESM — it
// imports JSON without an import attribute and reaches for window/document at
// module scope. esbuild resolves the JSON and produces a single ESM file that
// src/core/render/excalidraw-node/dom.ts imports after installing jsdom
// globals. Runs as part of `npm run build:server`.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mermaidStub = path.join(root, 'scripts/stubs/mermaid-stub.mjs');

await build({
  entryPoints: [path.join(root, 'scripts/excalidraw-node-entry.mjs')],
  outfile: path.join(root, 'dist/render/excalidraw-node.mjs'),
  bundle: true,
  minify: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // The exporter never spins up the font-subsetting worker (skipInliningFonts),
  // but the reference to it must not be resolved as a bundle entry.
  external: ['jsdom', '*.chunk.js'],
  // Mermaid (and the cytoscape/katex/parser tree behind it) is only reachable
  // from the editor's text-to-diagram dialog; swapping it for a stub keeps the
  // exporter bundle small.
  alias: { '@excalidraw/mermaid-to-excalidraw': mermaidStub, mermaid: mermaidStub },
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'warning'
});

process.stderr.write('Built dist/render/excalidraw-node.mjs\n');
