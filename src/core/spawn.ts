import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { EXPRESS_SERVER_URL, ENABLE_CANVAS_SYNC, EXCALIDRAW_NO_AUTOSTART } from './config.js';
import { getHealth, CANVAS_SERVICE_NAME, foreignServiceError, markCanvasIdentityVerified } from './canvas-client.js';

export { foreignServiceError };
import { readPidFile, removePidFile } from './pidfile.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function canvasPort(): number {
  try {
    const url = new URL(EXPRESS_SERVER_URL);
    return parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80);
  } catch {
    return 3000;
  }
}

function canvasHostname(): string {
  try {
    return new URL(EXPRESS_SERVER_URL).hostname;
  } catch {
    return '127.0.0.1';
  }
}

// The HOST the spawned server must bind so that health probes against
// EXPRESS_SERVER_URL actually reach it (e.g. [::1] URLs need an IPv6 bind).
function spawnBindHost(): string {
  const hostname = canvasHostname();
  if (hostname === 'localhost') return '127.0.0.1';
  return hostname.replace(/^\[|\]$/g, '');
}

function isLoopbackUrl(): boolean {
  return LOOPBACK_HOSTS.has(canvasHostname());
}

function unreachableError(reason: string): Error {
  const error = new Error(
    `Canvas server is not reachable at ${EXPRESS_SERVER_URL} (${reason}). ` +
    `Start it with \`mcp-excalidraw-server start\` or \`node dist/server.js\`.`
  );
  (error as any).code = 'CANVAS_UNREACHABLE';
  return error;
}

async function healthOrNull(timeoutMs = 500) {
  try {
    return await getHealth(timeoutMs);
  } catch {
    return null;
  }
}

// True only for a /health payload from OUR canvas server (v1.1+ identity
// marker). Anything else answering the port is a foreign service.
export function isCanvasHealth(health: { service?: string } | null): boolean {
  return health !== null && health.service === CANVAS_SERVICE_NAME;
}

export interface EnsureResult {
  url: string;
  spawned: boolean;
}

/**
 * Make sure OUR canvas server is answering at EXPRESS_SERVER_URL,
 * auto-spawning a detached one on a loopback URL when needed. A healthy
 * responder without the service identity marker is a foreign service —
 * proceeding against it would only produce confusing downstream errors.
 *
 * `force: true` (the explicit `start` command) overrides the auto-start
 * opt-outs — an explicit start is user intent, not auto-start.
 *
 * A concurrent-spawn race is safe: the canvas server's loopback guard makes
 * the losing process exit, and every caller here only proceeds once /health
 * answers.
 */
export async function ensureCanvasRunning(options: { timeoutMs?: number; force?: boolean } = {}): Promise<EnsureResult> {
  const timeoutMs = options.timeoutMs ?? 8000;

  const existing = await healthOrNull();
  if (existing) {
    if (!isCanvasHealth(existing)) {
      throw foreignServiceError();
    }
    markCanvasIdentityVerified();
    return { url: EXPRESS_SERVER_URL, spawned: false };
  }

  if (!options.force) {
    if (EXCALIDRAW_NO_AUTOSTART) {
      throw unreachableError('auto-start disabled by EXCALIDRAW_NO_AUTOSTART=1');
    }
    if (!ENABLE_CANVAS_SYNC) {
      throw unreachableError('auto-start disabled because ENABLE_CANVAS_SYNC=false');
    }
  }

  if (!isLoopbackUrl()) {
    throw unreachableError('refusing to auto-start a non-loopback canvas URL');
  }

  // dist/core/spawn.js -> dist/server.js; spawn args must be path strings
  const serverJs = fileURLToPath(new URL('../server.js', import.meta.url));
  const child = spawn(process.execPath, [serverJs], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PORT: String(canvasPort()), HOST: spawnBindHost() }
  });
  child.unref();
  logger.info(`Auto-starting canvas server (pid ${child.pid}) at ${EXPRESS_SERVER_URL}`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isCanvasHealth(await healthOrNull(400))) {
      markCanvasIdentityVerified();
      process.stderr.write(
        `Canvas server running at ${EXPRESS_SERVER_URL} — open it in a browser for screenshots and mermaid conversion.\n`
      );
      return { url: EXPRESS_SERVER_URL, spawned: true };
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw unreachableError(`auto-started server did not become healthy within ${timeoutMs}ms`);
}

export interface StopResult {
  stopped: boolean;
  pid?: number;
  message: string;
}

/**
 * Stop the canvas server. Identity-safe: we only ever signal the pid that a
 * live /health responder reports about ITSELF, and only when it identifies
 * as this canvas service. A stale pidfile is cleaned up, never killed —
 * recycled pids and unrelated apps squatting on the port are safe.
 */
export async function stopCanvas(): Promise<StopResult> {
  const port = canvasPort();
  const filePid = readPidFile(port);
  const health = await healthOrNull(2000);

  if (!health) {
    if (filePid !== null) {
      removePidFile(port);
      return { stopped: false, pid: filePid, message: `Canvas server is not running; stale pidfile removed (pid ${filePid}).` };
    }
    return { stopped: false, message: 'Canvas server is not running.' };
  }

  // Require the identity marker AND a sane positive pid: pid 0 / negative
  // values would make process.kill signal our own process group.
  const pid = isCanvasHealth(health) && Number.isSafeInteger(health.pid) && (health.pid as number) > 0
    ? health.pid as number
    : null;
  if (pid === null) {
    throw foreignServiceError();
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    throw new Error(`Failed to signal canvas server (pid ${pid}): ${(error as Error).message}`);
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!(await healthOrNull(300))) {
      removePidFile(port);
      return { stopped: true, pid, message: `Canvas server (pid ${pid}) stopped.` };
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  throw new Error(`Canvas server (pid ${pid}) did not stop within 5s.`);
}
