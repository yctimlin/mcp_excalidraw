import { prepareScene, renderSvgWithExcalidraw } from './excalidraw-node/index.js';
import { svgToPngIsolated } from './png.js';
import {
  collectFontEntriesFromSvg,
  fontFaceCss,
  fontFilesFor,
  needsSystemFonts,
  rewriteFontFamilies,
  substitutedFamilies
} from './fonts.js';

// Headless renderer: expanded Excalidraw scene in, SVG text or PNG out. No
// browser involved — Excalidraw's own exporter runs under jsdom (see
// excalidraw-node/) and resvg rasterizes. Used by the canvas server for
// /api/export/image and by the offline `render` CLI command.

export type RenderFormat = 'png' | 'svg';
export type RendererName = 'auto' | 'node' | 'browser';

export interface RenderOptions {
  format: RenderFormat;
  background?: boolean;           // default true
  viewBackgroundColor?: string;   // default #ffffff
  dark?: boolean;                 // Excalidraw's dark-mode filter
  scale?: number;                 // PNG only, 1..4 (clamped by max dimension)
  padding?: number;               // px around the scene, default 10
  elementIds?: string[];          // render only these (plus their bound text)
  frameId?: string;               // render one frame, clipped to it
  embedFonts?: boolean;           // SVG only: inline @font-face, default true
  systemFonts?: boolean;          // PNG only: let resvg use machine fonts; default auto (non-Latin text)
}

export interface RenderableScene {
  // Canvas-server elements (agent shorthand allowed) or native Excalidraw
  // elements; both are prepared the way the canvas tab prepares them.
  elements: Record<string, any>[];
  files: Record<string, any>;
}

export interface RenderResult {
  format: RenderFormat;
  data: string;                   // SVG text, or base64 PNG
  width: number;
  height: number;
  warnings: string[];
}

export class RenderError extends Error {
  status: 400 | 404;
  constructor(message: string, status: 400 | 404 = 400) {
    super(message);
    this.status = status;
  }
}

export const MAX_SCALE = 4;
export const DEFAULT_PADDING = 10;
export const DEFAULT_MAX_DIMENSION = 8192;

export function maxDimension(): number {
  const raw = Number(process.env.EXCALIDRAW_RENDER_MAX_DIM);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_DIMENSION;
}

export function validateRenderOptions(options: RenderOptions): Required<Omit<RenderOptions, 'elementIds' | 'frameId' | 'systemFonts'>> & Pick<RenderOptions, 'elementIds' | 'frameId' | 'systemFonts'> {
  if (options.format !== 'png' && options.format !== 'svg') {
    throw new RenderError('format must be "png" or "svg"');
  }
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale < 1 || scale > MAX_SCALE) {
    throw new RenderError(`scale must be a number between 1 and ${MAX_SCALE}`);
  }
  const padding = options.padding ?? DEFAULT_PADDING;
  if (!Number.isFinite(padding) || padding < 0) {
    throw new RenderError('padding must be a non-negative number');
  }
  if (options.elementIds && options.frameId) {
    throw new RenderError('elementIds and frameId are mutually exclusive');
  }
  if (options.elementIds && (!Array.isArray(options.elementIds) || options.elementIds.length === 0)) {
    throw new RenderError('elementIds must be a non-empty array of element ids');
  }
  return {
    format: options.format,
    background: options.background ?? true,
    viewBackgroundColor: options.viewBackgroundColor ?? '#ffffff',
    dark: options.dark ?? false,
    scale,
    padding,
    embedFonts: options.embedFonts ?? true,
    elementIds: options.elementIds,
    frameId: options.frameId,
    systemFonts: options.systemFonts
  };
}

// Keep the requested elements plus the text bound to them, so a selected
// shape still shows its label. Arrows bound to selected shapes are not pulled
// in implicitly — the caller decides what goes in the picture.
export function selectElements(elements: Record<string, any>[], elementIds: string[]): Record<string, any>[] {
  const wanted = new Set(elementIds);
  const byId = new Map(elements.map(el => [el.id, el]));
  const missing = elementIds.filter(id => !byId.has(id));
  if (missing.length > 0) {
    throw new RenderError(`Unknown element id(s): ${missing.join(', ')}`, 404);
  }
  return elements.filter(el =>
    wanted.has(el.id) || (el.type === 'text' && el.containerId && wanted.has(el.containerId))
  );
}

export function findFrame(elements: Record<string, any>[], frameId: string): Record<string, any> {
  const frame = elements.find(el => el.id === frameId);
  if (!frame) throw new RenderError(`Unknown frame id: ${frameId}`, 404);
  if (frame.type !== 'frame' && frame.type !== 'magicframe') {
    throw new RenderError(`Element ${frameId} is a ${frame.type}, not a frame`);
  }
  return frame;
}

function svgDimensions(svg: string): { width: number; height: number } {
  const root = svg.match(/^<svg[^>]*>/)?.[0] ?? '';
  const width = Number(root.match(/\swidth="([\d.]+)"/)?.[1]);
  const height = Number(root.match(/\sheight="([\d.]+)"/)?.[1]);
  return { width: Number.isFinite(width) ? width : 0, height: Number.isFinite(height) ? height : 0 };
}

export async function renderScene(scene: RenderableScene, rawOptions: RenderOptions): Promise<RenderResult> {
  const options = validateRenderOptions(rawOptions);
  const warnings: string[] = [];

  const live = await prepareScene(scene.elements.filter(el => el && !el.isDeleted));
  const elements = options.elementIds ? selectElements(live, options.elementIds) : live;
  const exportingFrame = options.frameId ? findFrame(live, options.frameId) : null;

  let svg = await renderSvgWithExcalidraw(elements, scene.files ?? {}, {
    background: options.background,
    viewBackgroundColor: options.viewBackgroundColor,
    dark: options.dark,
    padding: options.padding,
    exportingFrame
  });

  const fontEntries = collectFontEntriesFromSvg(svg);
  svg = rewriteFontFamilies(svg, fontEntries);
  warnings.push(...substitutedFamilies(fontEntries));

  const { width, height } = svgDimensions(svg);

  if (options.format === 'svg') {
    if (options.embedFonts) {
      svg = svg.replace(
        /<style class="style-fonts">[\s\S]*?<\/style>/,
        () => `<style class="style-fonts">\n${fontFaceCss(fontEntries)}\n</style>`
      );
    }
    return { format: 'svg', data: svg, width, height, warnings };
  }

  let scale = options.scale;
  const largest = Math.max(width, height);
  const limit = maxDimension();
  if (largest > 0 && largest * scale > limit) {
    // May go below 1 when the scene itself is larger than the limit; the cap
    // exists to bound memory, so the image shrinks rather than failing.
    scale = Math.max(0.1, Math.floor((limit / largest) * 1000) / 1000);
    warnings.push(`scale reduced to ${scale} so the image stays within ${limit}px`);
  }
  const loadSystemFonts = options.systemFonts ?? needsSystemFonts(elements);
  if (loadSystemFonts && options.systemFonts === undefined) {
    warnings.push('non-Latin text detected: system fonts were used, so output may differ across machines');
  }

  const png = await svgToPngIsolated(svg, {
    scale,
    fontFiles: fontFilesFor(fontEntries),
    loadSystemFonts,
    defaultFontFamily: 'Excalifont'
  });
  return { format: 'png', data: png.data.toString('base64'), width: png.width, height: png.height, warnings };
}
