#!/usr/bin/env node
// File path containment checks for MCP file tools (sanitizeFilePath) — pure
// Node, no canvas server. Run after `npm run build:server`:
//   node scripts/check-file-paths.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const failures = [];
function check(name, fn) {
  try { fn(); process.stdout.write(`ok   ${name}\n`); }
  catch (error) { failures.push(name); process.stdout.write(`FAIL ${name}\n     ${error.message}\n`); }
}

// <root>/exports is a symlink to <root>/real-exports and is the configured
// directory (like macOS /tmp -> /private/tmp); <root>/outside is not allowed.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'excalidraw-paths-'));
const realExports = path.join(root, 'real-exports');
const exportsDir = path.join(root, 'exports');
const outside = path.join(root, 'outside');
fs.mkdirSync(realExports);
fs.mkdirSync(outside);
fs.symlinkSync(realExports, exportsDir);
fs.writeFileSync(path.join(outside, 'secret.json'), '{}');
fs.writeFileSync(path.join(realExports, 'inside.excalidraw'), '{}');
fs.symlinkSync(outside, path.join(realExports, 'out'));
fs.symlinkSync(path.join(outside, 'secret.json'), path.join(realExports, 'linked.json'));
fs.symlinkSync(path.join(outside, 'created-by-write.json'), path.join(realExports, 'dangling.json'));
fs.symlinkSync(path.join(realExports, 'inside.excalidraw'), path.join(realExports, 'alias.excalidraw'));

process.env.EXCALIDRAW_EXPORT_DIR = exportsDir;
const { sanitizeFilePath, SCENE_FILE_EXTENSIONS, IMPORT_FILE_EXTENSIONS } =
  await import('../dist/core/normalize.js');
const real = fs.realpathSync(realExports);
const scene = p => sanitizeFilePath(path.join(exportsDir, p), SCENE_FILE_EXTENSIONS);

check('a new file inside the directory is allowed', () => {
  assert.equal(scene('diagram.excalidraw'), path.join(real, 'diagram.excalidraw'));
  assert.equal(scene('notes.excalidraw.md'), path.join(real, 'notes.excalidraw.md'));
});
check('a path into not-yet-created subdirectories is allowed', () => {
  assert.equal(scene('new/sub/scene.json'), path.join(real, 'new', 'sub', 'scene.json'));
});
check('../ escapes are blocked', () => {
  assert.throws(() => scene('../outside/escaped.json'), /Path traversal blocked/);
});
check('a symlinked directory pointing outside is blocked (#146)', () => {
  assert.throws(() => scene('out/escaped.excalidraw'), /Path traversal blocked/);
});
check('a symlinked file pointing outside is blocked', () => {
  assert.throws(() => scene('linked.json'), /Path traversal blocked/);
});
check('a broken symlink is blocked, so a write cannot create its target', () => {
  assert.throws(() => scene('dangling.json'), /broken symbolic link/);
  assert.equal(fs.existsSync(path.join(outside, 'created-by-write.json')), false);
});
check('a symlink that stays inside resolves to its target', () => {
  assert.equal(scene('alias.excalidraw'), path.join(real, 'inside.excalidraw'));
});
check('only the expected file types are allowed', () => {
  for (const name of ['config.txt', 'Makefile', '.bashrc', 'scene.excalidraw.png']) {
    assert.throws(() => scene(name), /File type blocked/, name);
  }
  assert.equal(
    sanitizeFilePath(path.join(exportsDir, 'Scene.Excalidraw.PNG'), IMPORT_FILE_EXTENSIONS),
    path.join(real, 'Scene.Excalidraw.PNG')
  );
  assert.throws(() => sanitizeFilePath(path.join(exportsDir, 'image.svg'), ['.png']), /File type blocked/);
});

fs.rmSync(root, { recursive: true, force: true });
if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} file path check(s) failed\n`);
  process.exit(1);
}
process.stdout.write('\nAll file path checks passed\n');
