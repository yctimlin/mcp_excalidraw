// PNG rasterizer worker — runs in a separate process on purpose.
//
// @resvg/resvg-js is a native addon. A segfault or abort inside a native
// module kills the entire Node process, which — when rendering happens
// in-process — takes down the canvas server and its whole in-memory scene.
// This worker keeps the risky native call out of the server: the parent
// (svgToPngIsolated in png.ts) spawns this file, sends one JSON request on
// stdin, and reads one JSON response line from stdout. If the worker dies
// (SIGSEGV, SIGABRT, non-zero exit), only the worker dies; the parent turns
// it into a clean error.
//
// Wire format (one JSON document per line):
//   request  (stdin):  { "svg": string, "options": PngOptions }
//   response (stdout): { "ok": true, "data": <base64 png>, "width": n, "height": n }
//                    | { "ok": false, "error": string }

import { svgToPng } from './png.js';

interface WorkerRequest {
  svg: string;
  options: {
    scale: number;
    fontFiles: string[];
    loadSystemFonts: boolean;
    defaultFontFamily: string;
  };
}

function main(): void {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => { input += chunk; });
  process.stdin.on('end', () => {
    let request: WorkerRequest;
    try {
      request = JSON.parse(input) as WorkerRequest;
      if (!request || typeof request.svg !== 'string' || !request.options) {
        throw new Error('invalid request payload');
      }
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, error: `bad request: ${(error as Error).message}` }) + '\n');
      process.exit(1);
    }
    try {
      const png = svgToPng(request.svg, request.options);
      const line = JSON.stringify({
        ok: true,
        data: png.data.toString('base64'),
        width: png.width,
        height: png.height
      }) + '\n';
      // Do NOT process.exit() right after write(): for payloads larger than
      // the pipe buffer the write is asynchronous and exit() truncates it.
      // Exiting from the flush callback guarantees the parent sees the full
      // response. Fall back after 10s in case the stream never drains.
      const killTimer = setTimeout(() => process.exit(0), 10_000);
      killTimer.unref();
      process.stdout.write(line, () => {
        clearTimeout(killTimer);
        process.exit(0);
      });
    } catch (error) {
      const line = JSON.stringify({ ok: false, error: (error as Error).message ?? String(error) }) + '\n';
      process.stdout.write(line, () => process.exit(1));
    }
  });
  // Never let an unhandled rejection escalate to a worker crash report that
  // masks the real problem — report it like a render failure instead.
  process.on('unhandledRejection', (reason) => {
    process.stdout.write(JSON.stringify({ ok: false, error: `unhandled rejection in PNG worker: ${String(reason)}` }) + '\n');
    process.exit(1);
  });
}

main();
