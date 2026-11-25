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

export async function convertMermaid(
  definition: string,
  options: MermaidConversionOptions = {}
): Promise<MermaidConversion> {
  const mod = await loadExcalidrawNode();
  const parsed = await mod.parseMermaidToExcalidraw(definition, options.config);
  // Regenerate ids so repeated conversions of the same diagram (Mermaid emits
  // stable ids like "A", "B") can't collide with elements already on the canvas.
  // The converter also assigns fractional `index` values starting at "a0",
  // which would collide with every earlier diagram's. The server's other create
  // paths leave `index` unset and let the canvas assign it, so do the same.
  const elements = mod.convertToExcalidrawElements(parsed.elements, { regenerateIds: true })
    .map(({ index: _index, ...element }: Record<string, any>) => element);
  return { elements, files: parsed.files ?? {} };
}
