#!/usr/bin/env node

// Wire-level checks for the stdio MCP entry point. Every case drives a real
// `dist/index.js` process over stdin/stdout with hand-written JSON-RPC frames,
// so what is asserted is exactly what a client sees on the wire.

import { spawn } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const serverPath = join(repoRoot, 'dist', 'index.js');
const runtime = process.env.MCP_RUNTIME || process.execPath;
const runtimeName = basename(runtime).toLowerCase();
const runtimeArgs = runtimeName.includes('bun') ? ['run', serverPath] : [serverPath];

const MODERN_VERSION = '2026-07-28';
const LEGACY_VERSION = '2025-06-18';
const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities';
const CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo';
const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';
const UNSUPPORTED_PROTOCOL_VERSION_CODE = -32022;
const INVALID_PARAMS_CODE = -32602;
const RESPONSE_TIMEOUT_MS = 20000;

// `read_diagram_guide` is the one tool that never touches the canvas server
// (see toolNeedsCanvasBeforeDispatch), so these checks stay hermetic.
const CANVAS_FREE_TOOL = 'read_diagram_guide';

function envelope(version = MODERN_VERSION) {
  return {
    [PROTOCOL_VERSION_META_KEY]: version,
    [CLIENT_CAPABILITIES_META_KEY]: {},
    [CLIENT_INFO_META_KEY]: { name: 'excalidraw-wire-test', version: '0.0.0' }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

/**
 * Runs one stdio connection: sends every message, resolves once `expected`
 * responses have come back on stdout.
 */
function exchange(messages, expected) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime, runtimeArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        ENABLE_CANVAS_SYNC: 'false',
        EXCALIDRAW_NO_AUTOSTART: '1',
        LOG_LEVEL: 'error'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const responses = [];
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      if (error) reject(error);
      else resolve({ responses, stderr });
    };

    const timer = setTimeout(() => {
      finish(new Error(
        `Timed out after ${RESPONSE_TIMEOUT_MS}ms waiting for ${expected} response(s); ` +
        `got ${responses.length}.${stderr ? `\nstderr:\n${stderr}` : ''}`
      ));
    }, RESPONSE_TIMEOUT_MS);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          responses.push(JSON.parse(line));
        } catch {
          finish(new Error(`Non-JSON line on stdout: ${line}`));
          return;
        }
      }
      if (responses.length >= expected) finish();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', error => finish(error));
    child.on('exit', code => {
      if (responses.length >= expected) finish();
      else finish(new Error(`Server exited with code ${code} before answering.${stderr ? `\nstderr:\n${stderr}` : ''}`));
    });

    for (const message of messages) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
  });
}

function resultOf(response, label) {
  assert(response !== undefined, `${label}: no response`);
  assert(response.error === undefined, `${label}: unexpected error ${JSON.stringify(response.error)}`);
  assert(response.result !== undefined, `${label}: response carried no result`);
  return response.result;
}

// Every 2026-07-28 result must carry the resultType discriminator, and the
// server should stamp its identity into _meta on the way out.
function assertModernResult(result, label) {
  assertEqual(result.resultType, 'complete', `${label}: resultType`);
  const serverInfo = result._meta?.[SERVER_INFO_META_KEY];
  assert(serverInfo !== undefined, `${label}: missing ${SERVER_INFO_META_KEY} in _meta`);
  assertEqual(serverInfo.name, 'mcp-excalidraw-server', `${label}: serverInfo.name`);
}

// tools/list and server/discover are CacheableResult extenders on 2026-07-28.
function assertCacheFields(result, label) {
  assert(Number.isSafeInteger(result.ttlMs) && result.ttlMs >= 0, `${label}: ttlMs must be a non-negative integer, got ${JSON.stringify(result.ttlMs)}`);
  assert(result.cacheScope === 'public' || result.cacheScope === 'private', `${label}: cacheScope must be public or private, got ${JSON.stringify(result.cacheScope)}`);
}

async function checkDiscovery() {
  const { responses } = await exchange([
    { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: envelope() } }
  ], 1);

  const result = resultOf(responses[0], 'server/discover');
  assert(Array.isArray(result.supportedVersions), 'server/discover: supportedVersions must be an array');
  assert(result.supportedVersions.includes(MODERN_VERSION), `server/discover: supportedVersions must advertise ${MODERN_VERSION}`);
  assert(
    result.supportedVersions.every(version => version >= MODERN_VERSION),
    'server/discover: the modern advertisement must not leak legacy revisions'
  );
  assert(result.capabilities?.tools !== undefined, 'server/discover: tools capability must be advertised');
  assertModernResult(result, 'server/discover');
  assertCacheFields(result, 'server/discover');
}

async function checkDirectCallWithoutInitialization() {
  // No initialize, no server/discover: the envelope alone opens the connection.
  const { responses } = await exchange([
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: envelope() } },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: CANVAS_FREE_TOOL, arguments: {}, _meta: envelope() }
    }
  ], 2);

  const listResult = resultOf(responses.find(r => r.id === 1), 'tools/list');
  assert(Array.isArray(listResult.tools) && listResult.tools.length > 0, 'tools/list: expected a non-empty tool list');
  assert(
    listResult.tools.some(tool => tool.name === CANVAS_FREE_TOOL),
    `tools/list: expected ${CANVAS_FREE_TOOL} to be advertised`
  );
  assertModernResult(listResult, 'tools/list');
  assertCacheFields(listResult, 'tools/list');

  const callResult = resultOf(responses.find(r => r.id === 2), 'tools/call');
  assert(callResult.isError !== true, `tools/call: tool reported an error: ${JSON.stringify(callResult.content)}`);
  assertEqual(callResult.content?.[0]?.type, 'text', 'tools/call: first content block type');
  assertModernResult(callResult, 'tools/call');
  assert(callResult.ttlMs === undefined, 'tools/call: results are not cacheable and must not carry ttlMs');
}

async function checkUnsupportedVersion() {
  const { responses } = await exchange([
    { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: envelope('2099-01-01') } }
  ], 1);

  const response = responses[0];
  assert(response?.error !== undefined, 'unsupported version: expected a JSON-RPC error');
  assertEqual(response.error.code, UNSUPPORTED_PROTOCOL_VERSION_CODE, 'unsupported version: error code');
  assert(
    Array.isArray(response.error.data?.supported) && response.error.data.supported.includes(MODERN_VERSION),
    `unsupported version: error data must name ${MODERN_VERSION} as supported`
  );
  assertEqual(response.error.data?.requested, '2099-01-01', 'unsupported version: echoed requested version');
}

async function checkInvalidEnvelope() {
  // A present-but-incomplete envelope claim is a validation error, never a
  // silent fall back to the legacy era.
  const { responses } = await exchange([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { _meta: { [PROTOCOL_VERSION_META_KEY]: MODERN_VERSION } }
    }
  ], 1);

  const response = responses[0];
  assert(response?.error !== undefined, 'invalid envelope: expected a JSON-RPC error');
  assertEqual(response.error.code, INVALID_PARAMS_CODE, 'invalid envelope: error code');
  assert(
    String(response.error.message).includes(CLIENT_CAPABILITIES_META_KEY),
    `invalid envelope: error message should name the missing key, got ${JSON.stringify(response.error.message)}`
  );
}

async function checkLegacyInitialize() {
  const { responses } = await exchange([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: LEGACY_VERSION,
        capabilities: {},
        clientInfo: { name: 'excalidraw-wire-test', version: '0.0.0' }
      }
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: CANVAS_FREE_TOOL, arguments: {} } }
  ], 3);

  const initResult = resultOf(responses.find(r => r.id === 1), 'initialize');
  assertEqual(initResult.protocolVersion, LEGACY_VERSION, 'initialize: negotiated protocol version');
  assertEqual(initResult.serverInfo?.name, 'mcp-excalidraw-server', 'initialize: serverInfo.name');
  assert(initResult.capabilities?.tools !== undefined, 'initialize: tools capability must be advertised');
  assert(initResult.resultType === undefined, 'initialize: 2025-era results must not carry resultType');

  const listResult = resultOf(responses.find(r => r.id === 2), 'legacy tools/list');
  assert(Array.isArray(listResult.tools) && listResult.tools.length > 0, 'legacy tools/list: expected a non-empty tool list');
  assert(listResult.resultType === undefined, 'legacy tools/list: 2025-era results must not carry resultType');
  assert(listResult.ttlMs === undefined, 'legacy tools/list: 2025-era results must not carry cache fields');

  const callResult = resultOf(responses.find(r => r.id === 3), 'legacy tools/call');
  assert(callResult.isError !== true, `legacy tools/call: tool reported an error: ${JSON.stringify(callResult.content)}`);
  assertEqual(callResult.content?.[0]?.type, 'text', 'legacy tools/call: first content block type');
  assert(callResult.resultType === undefined, 'legacy tools/call: 2025-era results must not carry resultType');
}

const checks = [
  ['server/discover advertises the modern era', checkDiscovery],
  ['direct tool calls work without initialization', checkDirectCallWithoutInitialization],
  ['unsupported protocol revisions are refused', checkUnsupportedVersion],
  ['malformed _meta envelopes are refused', checkInvalidEnvelope],
  [`legacy ${LEGACY_VERSION} initialize still works`, checkLegacyInitialize]
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

if (failed > 0) {
  console.error(`${failed} of ${checks.length} stdio wire checks failed.`);
  process.exit(1);
}

console.log(`All ${checks.length} stdio wire checks passed using ${runtimeName}.`);
