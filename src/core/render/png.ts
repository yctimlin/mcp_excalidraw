import { createRequire } from 'module';
import { spawn } from 'child_process';
import { fileURLToPath } from 'node:url';

// SVG -> PNG through resvg (native, prebuilt per platform, deterministic
// output for identical input). Fonts must be passed as TTF paths: resvg does
// not read @font-face from the SVG and ignores WOFF2 files.

export interface PngOptions {
  scale: number;
  fontFiles: string[];
  loadSystemFonts: boolean;
  defaultFontFamily: string;
}

export interface PngResult {
  data: Buffer;
  width: number;
  height: number;
}

// Loaded lazily via require: the package is CommonJS with a native addon,
// and this keeps `import` of the renderer cheap when only SVG is requested.
let resvgModule: any | null = null;
function loadResvg(): any {
  if (!resvgModule) {
    const require = createRequire(import.meta.url);
    resvgModule = require('@resvg/resvg-js');
  }
  return resvgModule;
}

// Excalidraw stores each image once as <symbol><image width="100%" .../></symbol>
// and places it with <use href="#id" width=W height=H>. Browsers size the
// symbol's content to the <use>; resvg does not and draws nothing. Inline
// every such <use> as a plain <image> of the placed size, keeping the use's
// other attributes (opacity, transform for flips, mask for crops).
export function inlineSymbolImages(svg: string): string {
  const symbols = new Map<string, string>();
  for (const match of svg.matchAll(/<symbol id="([^"]+)">\s*(<image\b[^>]*?)\s*\/?>(?:<\/image>)?\s*<\/symbol>/g)) {
    if (match[1] && match[2]) symbols.set(match[1], match[2]);
  }
  if (symbols.size === 0) return svg;
  return svg.replace(/<use\b([^>]*?)\/?>(?:<\/use>)?/g, (whole, attrs: string) => {
    const id = attrs.match(/\b(?:xlink:)?href="#([^"]+)"/)?.[1];
    const image = id ? symbols.get(id) : undefined;
    if (!image) return whole;
    const width = attrs.match(/\swidth="([^"]+)"/)?.[1];
    const height = attrs.match(/\sheight="([^"]+)"/)?.[1];
    if (!width || !height) return whole;
    const sized = image
      .replace(/\swidth="100%"/, ` width="${width}"`)
      .replace(/\sheight="100%"/, ` height="${height}"`);
    const rest = attrs.replace(/\s(?:xlink:)?href="[^"]*"|\swidth="[^"]*"|\sheight="[^"]*"/g, '');
    return `${sized}${rest}/>`;
  });
}

export function svgToPng(svg: string, options: PngOptions): PngResult {
  const { Resvg } = loadResvg();
  const resvg = new Resvg(inlineSymbolImages(svg), {
    fitTo: { mode: 'zoom', value: options.scale },
    font: {
      loadSystemFonts: options.loadSystemFonts,
      fontFiles: options.fontFiles,
      defaultFontFamily: options.defaultFontFamily
    },
    logLevel: 'off'
  });
  const image = resvg.render();
  return { data: image.asPng(), width: image.width, height: image.height };
}

// Rasterize in a child process (png-worker.ts) so a crash inside the native
// resvg addon cannot take down the caller — most importantly the canvas
// server, whose in-memory scene would be lost with the process. A dead
// worker surfaces as an ordinary Error here; the server keeps running.
const PNG_WORKER_PATH = fileURLToPath(new URL('./png-worker.js', import.meta.url));
const PNG_WORKER_TIMEOUT_MS = Number(process.env.EXCALIDRAW_PNG_WORKER_TIMEOUT_MS) || 120_000;

export async function svgToPngIsolated(svg: string, options: PngOptions): Promise<PngResult> {
  return new Promise<PngResult>((resolve, reject) => {
    const child = spawn(process.execPath, [PNG_WORKER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`PNG worker timed out after ${PNG_WORKER_TIMEOUT_MS} ms`));
    }, PNG_WORKER_TIMEOUT_MS);

    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });

    child.on('error', (error: Error) => {
      finish(new Error(`Failed to start PNG worker: ${error.message}`));
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      const response = stdout.trim().split('\n').pop();
      if (code === 0 && response) {
        try {
          const parsed = JSON.parse(response) as { ok: boolean; data?: string; width?: number; height?: number; error?: string };
          if (parsed.ok && typeof parsed.data === 'string') {
            finish();
            resolve({
              data: Buffer.from(parsed.data, 'base64'),
              width: parsed.width ?? 0,
              height: parsed.height ?? 0
            });
            return;
          }
          finish(new Error(parsed.error ?? 'PNG worker returned an unknown failure'));
          return;
        } catch {
          // fall through to the crash report below
        }
      }
      const detail = signal
        ? `PNG worker terminated by ${signal}`
        : `PNG worker exited with code ${code}`;
      const hint = 'The native resvg addon crashed in an isolated worker; the server is unaffected. Try format "svg", renderer "browser", or reinstall @resvg/resvg-js (a corrupted platform binary can crash like this).';
      const tail = stderr.trim().slice(-300);
      finish(new Error(`${detail}: ${hint}${tail ? ` Worker stderr: ${tail}` : ''}`));
    });

    try {
      child.stdin.write(JSON.stringify({ svg, options }) + '\n');
      child.stdin.end();
    } catch (error) {
      finish(new Error(`Failed to send request to PNG worker: ${(error as Error).message}`));
    }
  });
}
