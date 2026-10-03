import { createRequire } from 'module';

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
