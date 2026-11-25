#!/usr/bin/env node
// Bundle Excalidraw's exporter for Node: dist/render/excalidraw-node.mjs.
//
// Why a bundle: @excalidraw/excalidraw's dist is browser-oriented ESM — it
// imports JSON without an import attribute and reaches for window/document at
// module scope. esbuild resolves the JSON and produces a single ESM file that
// src/core/render/excalidraw-node/dom.ts imports after installing jsdom
// globals. Runs as part of `npm run build:server`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mermaidStub = path.join(root, 'scripts/stubs/mermaid-stub.mjs');

// The server's Mermaid conversion needs the top-level v3 package (Pele). If an
// install ever resolved v2 there, the stub below would be applied to the wrong
// copy and the build would still succeed, so check before bundling.
const mermaidPkg = JSON.parse(fs.readFileSync(
  path.join(root, 'node_modules/@excalidraw/mermaid-to-excalidraw/package.json'), 'utf8'));
if (Number(String(mermaidPkg.version).split('.')[0]) < 3) {
  throw new Error(`@excalidraw/mermaid-to-excalidraw ${mermaidPkg.version} is installed at the top level; v3 or newer is required.`);
}

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
  // The editor's text-to-diagram dialog pulls in its own copy of
  // mermaid-to-excalidraw (v2, which drags in mermaid and the cytoscape/katex/
  // parser tree). The exporter never opens that dialog, so that copy and
  // `mermaid` are swapped for a stub. The server's own Mermaid conversion (the
  // top-level v3 package, which has no such dependencies) stays real.
  alias: { mermaid: mermaidStub },
  plugins: [{
    name: 'stub-editor-mermaid',
    setup(b) {
      b.onResolve({ filter: /^@excalidraw\/mermaid-to-excalidraw$/ }, args =>
        args.importer.includes(`${path.sep}@excalidraw${path.sep}excalidraw${path.sep}`)
          ? { path: mermaidStub }
          : undefined);
    }
  }],
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'warning'
});

// The editor's v2 copy (mermaid, cytoscape, katex) must stay stubbed out, and
// the real v3 converter must be in the bundle.
const bundle = fs.readFileSync(path.join(root, 'dist/render/excalidraw-node.mjs'), 'utf8');
if (bundle.includes('cytoscape') || !bundle.includes('PeleError')) {
  throw new Error('Unexpected Mermaid code in dist/render/excalidraw-node.mjs: the editor copy leaked in or the v3 converter is missing.');
}

process.stderr.write('Built dist/render/excalidraw-node.mjs\n');
