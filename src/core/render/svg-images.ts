// The rasterizer behind PNG export does not load fonts for SVG documents that
// are embedded through <image href="data:image/svg+xml;...">, so their text
// disappears. Inline such images as nested <svg> elements instead: same
// geometry, but the text now uses the fonts loaded for the main document.
// Used for PNG output only; SVG output keeps the <image> as exported.

const SVG_IMAGE = /<image\b([^>]*?)\bhref="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"([^>]*?)\/>/g;
const FILLS_VIEWPORT = /width="100%"/;
const FILLS_VIEWPORT_H = /height="100%"/;

export function inlineSvgImages(svg: string): string {
  if (!svg.includes('data:image/svg+xml')) return svg;
  return svg.replace(SVG_IMAGE, (whole, before: string, base64: string, after: string) => {
    const attrs = `${before} ${after}`;
    // Only the exporter's own full-size <symbol> image is safe to rewrite
    if (!FILLS_VIEWPORT.test(attrs) || !FILLS_VIEWPORT_H.test(attrs)) return whole;
    const source = Buffer.from(base64, 'base64').toString('utf-8').replace(/<\?xml[^>]*\?>\s*/, '');
    const match = /^\s*<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(source);
    if (!match) return whole;
    const rootAttrs = match[1] ?? '';
    const style = /\sstyle="([^"]*)"/.exec(rootAttrs)?.[1];
    const fill = /\sfill="([^"]*)"/.exec(rootAttrs)?.[1];
    const viewBox = /\sviewBox="([^"]*)"/.exec(rootAttrs)?.[1];
    // The rasterizer ignores `style` (font, color) on a nested <svg> root, so
    // carry it on a wrapping group; keep the image's own pixel size.
    const size = ['width', 'height']
      .map(name => new RegExp(`\\s${name}="([^"]*)"`).exec(rootAttrs)?.[1] ?? '100%')
      .map((value, i) => `${i === 0 ? 'width' : 'height'}="${value}"`)
      .join(' ');
    const group = `<g${style ? ` style="${style}"` : ''}${fill ? ` fill="${fill}"` : ''}>${match[2]}</g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg"${viewBox ? ` viewBox="${viewBox}"` : ''} preserveAspectRatio="none" ${size}>${group}</svg>`;
  });
}
