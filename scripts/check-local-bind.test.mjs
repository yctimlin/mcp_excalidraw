#!/usr/bin/env node

// Black-box regression for the local bind harness (scripts/check-local-bind.mjs).
//
// The harness spawns the real canvas server in its default in-memory mode. If
// EXCALIDRAW_DATA_DIR reaches that child it silently flips to durable mode and
// reads/writes a developer data directory. Two inputs can cause that:
//   1. the variable exported by whoever runs the harness (inherited via
//      process.env), and
//   2. the variable set in the repo-local .env, which dotenv.config() re-injects
//      inside src/server.ts.
// Each case below runs the real harness CLI inside an isolated fixture that
// holds the built server and a shared dependency layout, so the child's
// dotenv reads the fixture's .env rather than the developer's. The harness must
// succeed and must not create the sentinel data directory. The final case
// reproduces the pre-fix harness by removing the env pin and asserts the same
// fixture DOES pollute, so the isolation assertions cannot pass vacuously.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const harnessSource = join(repoRoot, 'scripts', 'check-local-bind.mjs');
const candidateHarness = readFileSync(harnessSource, 'utf8');
const nodeModulesLink = 'node_modules';

// A fixture shaped like the repo root the harness expects: the harness under
// test, the built server, and a symlinked dependency layout. The harness runs
// the server with cwd set to this fixture, so dotenv.config() inside
// src/server.ts reads the fixture's .env and never the real repo's.
function makeFixture(harnessText) {
  const fixture = mkdtempSync(join(tmpdir(), 'bind-fixture-'));
  mkdirSync(join(fixture, 'scripts'), { recursive: true });
  writeFileSync(join(fixture, 'scripts', 'check-local-bind.mjs'), harnessText);
  writeFileSync(join(fixture, 'package.json'), '{"type":"module","private":true}\n');
  cpSync(join(repoRoot, 'dist'), join(fixture, 'dist'), { recursive: true });
  symlinkSync(join(repoRoot, 'node_modules'), join(fixture, nodeModulesLink), 'junction');
  return fixture;
}

function removeFixture(fixture) {
  // Remove the symlink first so a recursive delete can never walk into the
  // real dependency tree.
  const link = join(fixture, nodeModulesLink);
  if (existsSync(link)) unlinkSync(link);
  rmSync(fixture, { recursive: true, force: true });
}

function runHarness(fixture, dataDir) {
  const env = { ...process.env };
  delete env.EXCALIDRAW_DATA_DIR;
  if (dataDir) env.EXCALIDRAW_DATA_DIR = dataDir;
  return spawnSync(process.execPath, [join(fixture, 'scripts', 'check-local-bind.mjs')], {
    env,
    encoding: 'utf8',
    timeout: 90000,
  });
}

function harnessFailure(run) {
  return `harness exited ${run.status} (signal ${run.signal})\n--- stdout ---\n${run.stdout}\n--- stderr ---\n${run.stderr}`;
}

test('caller-exported EXCALIDRAW_DATA_DIR never reaches the canvas child', () => {
  const fixture = makeFixture(candidateHarness);
  const sentinel = join(fixture, 'durable-data');
  try {
    const run = runHarness(fixture, sentinel);
    assert.equal(run.status, 0, harnessFailure(run));
    assert.equal(existsSync(sentinel), false, 'harness child created the caller data directory');
  } finally {
    removeFixture(fixture);
  }
});

test('fixture repo-local .env EXCALIDRAW_DATA_DIR is not re-injected', () => {
  const fixture = makeFixture(candidateHarness);
  const sentinel = join(fixture, 'durable-data');
  writeFileSync(join(fixture, '.env'), `EXCALIDRAW_DATA_DIR="${sentinel}"\n`);
  try {
    const run = runHarness(fixture, null);
    assert.equal(run.status, 0, harnessFailure(run));
    assert.equal(existsSync(sentinel), false, 'dotenv re-injected the .env data directory');
  } finally {
    removeFixture(fixture);
  }
});

test('default in-memory path passes with no durable configuration', () => {
  const fixture = makeFixture(candidateHarness);
  try {
    const run = runHarness(fixture, null);
    assert.equal(run.status, 0, harnessFailure(run));
    assert.match(run.stdout, /Local bind check passed/);
  } finally {
    removeFixture(fixture);
  }
});

test('control: without the env pin the same fixture pollutes the data directory', () => {
  const leakyHarness = candidateHarness.replace(/\n\s*EXCALIDRAW_DATA_DIR: '',/, '\n');
  assert.notEqual(
    leakyHarness,
    candidateHarness,
    'positive-control anchor missing: cannot reproduce the pre-fix harness',
  );
  const fixture = makeFixture(leakyHarness);
  const sentinel = join(fixture, 'durable-data');
  try {
    const run = runHarness(fixture, sentinel);
    assert.equal(run.status, 0, `leaky harness was expected to false-pass:\n${run.stdout}\n${run.stderr}`);
    assert.equal(
      existsSync(sentinel),
      true,
      'control did not pollute; the isolation assertions would be vacuous',
    );
  } finally {
    removeFixture(fixture);
  }
});
