// Turn the server's stored elements into a VALID Excalidraw scene.
//
// The REST API accepts an agent-friendly shorthand: a shape's text is passed
// as `label: { text }` (or a bare `text`), and callers omit the structural
// fields Excalidraw fills in itself (seed, versionNonce, angle, groupIds,
// roundness, opacity, boundElements, ...). Elements are stored roughly as they
// arrive, so exporting them verbatim produced files that no real Excalidraw
// reader can load: the reference editor and the Obsidian Excalidraw plugin bind
// a shape's text as a SEPARATE `text` element via `containerId` + the
// container's `boundElements`, and they silently DROP elements that are missing
// required fields. Opening such an export in the Obsidian plugin parses zero
// valid elements and re-saves the note EMPTY — destroying the drawing.
//
// This module expands the label shorthand into bound text elements and fills
// every required field, matching the schema excalidraw.com and the Obsidian
// plugin actually accept. Existing fields are preserved (fill-missing only), so
// a real scene that was imported and re-exported keeps its own seeds, bindings,
// and z-order. Fractional `index` is intentionally omitted: every Excalidraw
// reader runs `restore()` on load, which regenerates missing indices.

import { ServerElement, normalizeFontFamily } from '../types.js';

const LINE_HEIGHT = 1.25;
// Per-character advance as a fraction of font size, used only to seed a bound
// label's width/height. Excalidraw re-measures and re-lays-out bound text on
// load, so this only has to be non-degenerate, not pixel-accurate.
const CHAR_ADVANCE = 0.55;
// Excalidraw's default handwritten font (Excalifont) — used only when a text
// element carries no fontFamily at all.
const DEFAULT_FONT_FAMILY = 5;

// Server bookkeeping and input shorthand that must never reach a scene file.
const STRIP_KEYS = [
  'createdAt', 'updatedAt', 'syncedAt', 'source', 'syncTimestamp',
  'label', 'start', 'end',
];

function randInt(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

function textDims(text: string, fontSize: number): { width: number; height: number } {
  const lines = String(text ?? '').split('\n');
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return {
    width: Math.max(longest * fontSize * CHAR_ADVANCE, 10),
    height: Math.max(lines.length, 1) * fontSize * LINE_HEIGHT,
  };
}

// Fill the fields every Excalidraw element requires, without clobbering any the
// element already carries (so imported real scenes round-trip losslessly).
function withBaseFields(source: Record<string, any>): Record<string, any> {
  const el = { ...source };
  for (const key of STRIP_KEYS) delete el[key];

  const defaults: Record<string, any> = {
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: randInt(),
    version: 1,
    versionNonce: randInt(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (el[key] === undefined) el[key] = value;
  }
  return el;
}

function normalizePoints(points: any): [number, number][] {
  if (!Array.isArray(points) || points.length === 0) return [[0, 0], [1, 0]];
  const out = points.map((p: any): [number, number] =>
    Array.isArray(p) ? [Number(p[0]) || 0, Number(p[1]) || 0] : [Number(p?.x) || 0, Number(p?.y) || 0]
  );
  return out.length >= 2 ? out : [[0, 0], ...out];
}

function makeTextElement(source: Record<string, any>, overrides: Record<string, any> = {}): Record<string, any> {
  const fontSize = source.fontSize ?? 20;
  const text = source.text ?? '';
  const dims = textDims(text, fontSize);
  const el = withBaseFields({
    ...source,
    width: source.width ?? dims.width,
    height: source.height ?? dims.height,
  });
  return {
    ...el,
    type: 'text',
    text,
    originalText: source.originalText ?? text,
    fontSize,
    fontFamily: normalizeFontFamily(source.fontFamily) ?? DEFAULT_FONT_FAMILY,
    textAlign: source.textAlign ?? 'left',
    verticalAlign: source.verticalAlign ?? 'top',
    containerId: source.containerId ?? null,
    lineHeight: source.lineHeight ?? LINE_HEIGHT,
    autoResize: source.autoResize ?? true,
    ...overrides,
  };
}

function makeLinearElement(source: Record<string, any>): Record<string, any> {
  const points = normalizePoints(source.points);
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const el = withBaseFields({
    ...source,
    width: source.width ?? (Math.max(...xs) - Math.min(...xs)),
    height: source.height ?? (Math.max(...ys) - Math.min(...ys)),
  });
  return {
    ...el,
    type: source.type,
    points,
    lastCommittedPoint: source.lastCommittedPoint ?? null,
    startBinding: source.startBinding ?? null,
    endBinding: source.endBinding ?? null,
    startArrowhead: source.startArrowhead ?? null,
    endArrowhead: source.endArrowhead ?? (source.type === 'arrow' ? 'arrow' : null),
    elbowed: source.elbowed ?? false,
  };
}

// Pull the shorthand label text off a shape, whether it arrived as
// `label: { text }` or as a bare `text` on a non-text element.
function extractLabelText(source: Record<string, any>): string | null {
  if (source.label && typeof source.label.text === 'string') return source.label.text;
  if (source.type !== 'text' && typeof source.text === 'string') return source.text;
  return null;
}

/**
 * Normalize the server's element list into valid Excalidraw elements. Shapes
 * carrying a shorthand label get a bound text element appended immediately
 * after them; everything else is field-completed in place.
 */
export function normalizeSceneElements(serverElements: ServerElement[]): Record<string, any>[] {
  const usedIds = new Set<string>(serverElements.map(e => e.id).filter(Boolean) as string[]);
  const freshId = (base: string): string => {
    let id = base;
    let n = 1;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    return id;
  };

  const out: Record<string, any>[] = [];
  for (const raw of serverElements) {
    const source = raw as unknown as Record<string, any>;
    const type = source.type;

    if (type === 'text') {
      out.push(makeTextElement(source));
      continue;
    }

    if (type === 'rectangle' || type === 'ellipse' || type === 'diamond') {
      const shape = withBaseFields({
        ...source,
        width: source.width ?? 0,
        height: source.height ?? 0,
      });

      const labelText = extractLabelText(source);
      const alreadyHasBoundText = Array.isArray(shape.boundElements)
        && shape.boundElements.some((b: any) => b?.type === 'text');

      if (labelText != null && labelText !== '' && !alreadyHasBoundText) {
        const labelId = freshId(`${shape.id}-label`);
        const fontSize = source.fontSize ?? 16;
        const dims = textDims(labelText, fontSize);
        shape.boundElements = [
          ...(Array.isArray(shape.boundElements) ? shape.boundElements : []),
          { type: 'text', id: labelId },
        ];
        out.push(shape);
        out.push(makeTextElement(
          {
            id: labelId,
            type: 'text',
            x: shape.x + (shape.width - dims.width) / 2,
            y: shape.y + (shape.height - dims.height) / 2,
            text: labelText,
            fontSize,
            fontFamily: source.labelFontFamily ?? source.fontFamily,
            strokeColor: source.labelColor ?? source.strokeColor,
          },
          { containerId: shape.id, textAlign: 'center', verticalAlign: 'middle' }
        ));
      } else {
        out.push(shape);
      }
      continue;
    }

    if (type === 'arrow' || type === 'line') {
      out.push(makeLinearElement(source));
      continue;
    }

    // image / freedraw / anything else: complete base fields, pass through.
    out.push(withBaseFields(source));
  }

  return out;
}
