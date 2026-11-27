import { loadExcalidrawNode } from './dom.js';

// Mermaid -> Excalidraw conversion in Node. @excalidraw/mermaid-to-excalidraw
// (v3, Pele layout engine) needs a DOMParser and canvas text measurement; the
// jsdom globals and bundled-font metrics installed by loadExcalidrawNode()
// provide both, so no browser tab is involved.

export interface MermaidConversionOptions {
  // Forwarded to mermaid-to-excalidraw (elbow, themeVariables, maxEdges, maxTextSize).
  config?: Record<string, unknown>;
}

export interface MermaidConversion {
  // Native Excalidraw elements with fresh ids, ready to merge into a scene.
  elements: Record<string, any>[];
  // Binary files for diagram types that fall back to an SVG image.
  files: Record<string, any>;
}

// The diagram itself is at fault (syntax error, unsupported type, size limit).
// Anything else thrown by convertMermaid is an internal failure.
export class MermaidInputError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'MermaidInputError';
    this.code = code;
  }
}

// Pele styles its SVG fallbacks with chained CSS custom properties
// (`--_bg:var(--pele-bg,#fff)` ... `fill="var(--_bg)"`). Browsers resolve
// them, but the rasterizer behind headless PNG export does not, so fills turn
// black. Resolve every var() to its value (or fallback) up front; with no host
// theme the result is identical to what a browser shows.
const VAR_REF = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*?))?\s*\)/g;
const VAR_DECLARATION = /(--[\w-]+)\s*:\s*([^;"}]+)/g;

export function flattenCssVariables(svg: string): string {
  const declared = new Map<string, string>();
  for (const [, name, value] of svg.matchAll(VAR_DECLARATION)) {
    if (name && value !== undefined && !declared.has(name)) declared.set(name, value.trim());
  }
  let out = svg;
  // Declarations reference other declarations; a few passes settle the chain.
  for (let pass = 0; pass < 8 && out.includes('var('); pass++) {
    out = out.replace(VAR_REF, (_, name: string, fallback?: string) => declared.get(name) ?? fallback ?? '');
  }
  // With every reference resolved the declarations are dead weight, and the
  // rasterizer drops a whole `style` attribute that contains them.
  return out.replace(/\sstyle="([^"]*)"/g, (_, css: string) => {
    const kept = css.replace(/--[\w-]+\s*:[^;]*;?/g, '').replace(/^;+|;+$/g, '');
    return kept ? ` style="${kept}"` : '';
  });
}

// Generic families resolve to whatever the machine has, and the headless
// rasterizer has only the bundled fonts: name them first, keep the generic as
// the browser fallback.
function pinBundledFonts(svg: string): string {
  // Multi-word family names must be quoted for the rasterizer to match them.
  // Pele writes double-quoted attributes, so single quotes are safe inside.
  return svg
    // The `font` shorthand would otherwise reset the family set below
    .replace(/font:\s*([\d.]+px)\s+sans-serif/g, "font-size:$1;font-family:'Liberation Sans',sans-serif")
    .replace(/font:\s*([\d.]+px)\s+monospace/g, "font-size:$1;font-family:'Cascadia Code',monospace")
    .replace(/font-family(="|:\s*)sans-serif/g, "font-family$1'Liberation Sans',sans-serif")
    .replace(/font-family(="|:\s*)monospace/g, "font-family$1'Cascadia Code',monospace");
}

const SVG_BASE64 = /^data:image\/svg\+xml;base64,/;

function flattenSvgFile(file: Record<string, any>): Record<string, any> {
  if (file.mimeType !== 'image/svg+xml' || typeof file.dataURL !== 'string' || !SVG_BASE64.test(file.dataURL)) {
    return file;
  }
  const svg = Buffer.from(file.dataURL.replace(SVG_BASE64, ''), 'base64').toString('utf-8');
  if (!svg.includes('var(')) return file;
  const flattened = Buffer.from(pinBundledFonts(flattenCssVariables(svg)), 'utf-8').toString('base64');
  return { ...file, dataURL: `data:image/svg+xml;base64,${flattened}` };
}

export async function convertMermaid(
  definition: string,
  options: MermaidConversionOptions = {}
): Promise<MermaidConversion> {
  // Failing to load the renderer bundle is an internal error, not bad input.
  const mod = await loadExcalidrawNode();

  let parsed;
  try {
    parsed = await mod.parseMermaidToExcalidraw(definition, options.config);
  } catch (error) {
    if ((error as Error)?.name === 'PeleError') {
      throw new MermaidInputError((error as Error).message, (error as { code?: string }).code);
    }
    throw error;
  }

  // Regenerate ids so repeated conversions of the same diagram (Mermaid emits
  // stable ids like "A", "B") can't collide with elements already on the canvas.
  // The converter also assigns fractional `index` values starting at "a0",
  // which would collide with every earlier diagram's. The server's other create
  // paths leave `index` unset and let the canvas assign it, so do the same.
  const elements = mod.convertToExcalidrawElements(parsed.elements, { regenerateIds: true })
    .map(({ index: _index, ...element }: Record<string, any>) => element);
  const files = Object.fromEntries(
    Object.entries(parsed.files ?? {}).map(([id, file]) => [id, flattenSvgFile(file)])
  );
  return { elements, files };
}
