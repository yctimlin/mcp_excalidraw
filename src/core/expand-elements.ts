import { ServerElement, normalizeFontFamily } from '../types.js';

// Expand the server's agent-friendly element format into real Excalidraw
// elements: strip server metadata, add Excalidraw defaults, generate bound
// text elements for `label`/`text` on shapes and arrows, and resolve arrow
// bindings — so exported scenes render fully in third-party consumers
// (excalidraw.com, the Obsidian Excalidraw plugin) without a browser tab.
//
// Extracted from share-url.ts (cleanElementsForShare), which shares this
// exact conversion for the encrypted excalidraw.com upload.

export interface ExpandOptions {
  // Derive seeds, versionNonces, and `updated` timestamps from element ids
  // and updatedAt instead of Math.random()/Date.now(), so repeated exports
  // of an unchanged scene are byte-identical (keeps committed .excalidraw
  // files diff-clean).
  deterministic?: boolean;
}

// Canonical key order for exported elements: identity/geometry first, the
// rest alphabetical — so a no-op import→export cycle is byte-identical and
// committed .excalidraw files produce minimal git diffs.
const KEY_ORDER = ['id', 'type', 'x', 'y', 'width', 'height'];
export function canonicalizeKeys(v: any): any {
  if (Array.isArray(v)) return v.map(canonicalizeKeys);
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).sort((a, b) => {
      const ia = KEY_ORDER.indexOf(a); const ib = KEY_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? KEY_ORDER.length : ia) - (ib === -1 ? KEY_ORDER.length : ib);
      return a < b ? -1 : 1;
    });
    const out: Record<string, any> = {};
    for (const k of keys) out[k] = canonicalizeKeys(v[k]);
    return out;
  }
  return v;
}

// FNV-1a 32-bit hash — stable positive int from a string
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function expandElementsForExport(
  sourceElements: ServerElement[],
  options: ExpandOptions = {}
): Record<string, any>[] {
  const { deterministic = false } = options;
  const seedFor = (key: string): number =>
    deterministic ? (fnv1a(key) % 2147483646) + 1 : Math.floor(Math.random() * 2147483647);
  const updatedFor = (el: any): number => {
    if (!deterministic) return Date.now();
    // Prefer a preserved `updated` (re-imported scene) over the server's
    // updatedAt, so no-op import→export cycles are byte-identical.
    if (typeof el.updated === 'number') return el.updated;
    const parsed = Date.parse(el.updatedAt ?? el.createdAt ?? '');
    return Number.isNaN(parsed) ? 1 : parsed;
  };

  const cleanedExportElements: Record<string, any>[] = [];
  const boundTextElements: Record<string, any>[] = [];
  let indexCounter = 0;

  function makeBaseElement(el: any, rest: any): Record<string, any> {
    return {
      ...rest,
      angle: rest.angle ?? 0,
      strokeColor: rest.strokeColor ?? '#1e1e1e',
      backgroundColor: rest.backgroundColor ?? 'transparent',
      fillStyle: rest.fillStyle ?? 'solid',
      strokeWidth: rest.strokeWidth ?? 2,
      strokeStyle: rest.strokeStyle ?? 'solid',
      roughness: rest.roughness ?? 1,
      opacity: rest.opacity ?? 100,
      groupIds: rest.groupIds ?? [],
      frameId: rest.frameId ?? null,
      index: rest.index ?? `a${indexCounter++}`,
      roundness: rest.roundness ?? (
        el.type === 'rectangle' || el.type === 'diamond' || el.type === 'ellipse'
          ? { type: 3 } : null
      ),
      seed: rest.seed ?? seedFor(`${el.id}:seed`),
      version: rest.version ?? 1,
      versionNonce: rest.versionNonce ?? seedFor(`${el.id}:nonce`),
      isDeleted: false,
      boundElements: rest.boundElements ?? null,
      updated: updatedFor(el),
      link: rest.link ?? null,
      locked: rest.locked ?? false
    };
  }

  for (const el of sourceElements) {
    // Strip server-only fields
    const {
      createdAt, updatedAt, syncedAt, source: _src,
      syncTimestamp, label, start, end, text,
      version: _ver,
      ...rest
    } = el as any;

    const base = makeBaseElement(el, rest);

    // Standalone text elements: keep text directly
    if (el.type === 'text') {
      base.text = text ?? '';
      base.originalText = text ?? '';
      base.fontSize = rest.fontSize ?? 20;
      // Agent-created text often has no dimensions (server stores null);
      // third-party consumers clip width-less text, so estimate like the
      // design guide does (~0.6×fontSize per char, 1.25 line height).
      // Treat 0 as unmeasured, not just null/undefined: pre-2.0.0 headless
      // creation stored width/height 0, and re-imported scenes carry it back
      // into the store — zero-size text renders invisible in consumers that
      // trust stored dimensions.
      if (!base.width || !base.height) {
        const lines = String(base.text).split('\n');
        const longestLine = Math.max(1, ...lines.map((l: string) => l.length));
        base.width = base.width || Math.ceil(longestLine * base.fontSize * 0.6);
        base.height = base.height || Math.ceil(lines.length * base.fontSize * 1.25);
      }
      base.fontFamily = normalizeFontFamily(rest.fontFamily) ?? 1;
      base.textAlign = rest.textAlign ?? 'center';
      base.verticalAlign = rest.verticalAlign ?? 'middle';
      base.autoResize = rest.autoResize ?? true;
      base.lineHeight = rest.lineHeight ?? 1.25;
      base.containerId = rest.containerId ?? null;
      cleanedExportElements.push(base);
      continue;
    }

    // Arrows: preserve browser-synced bindings; for agent-created arrows the
    // server keeps start/end refs with null bindings (points are kept correct
    // by rerouteBoundArrows), so synthesize live bindings from the refs —
    // otherwise arrows don't stick to shapes when moved in Excalidraw.
    if (el.type === 'arrow' || el.type === 'line') {
      base.points = rest.points ?? [[0, 0], [100, 0]];
      base.lastCommittedPoint = null;
      if (rest.startBinding) {
        base.startBinding = { ...rest.startBinding, fixedPoint: rest.startBinding.fixedPoint ?? null };
      } else if (start?.id) {
        base.startBinding = { elementId: start.id, focus: 0, gap: 4, fixedPoint: null };
      } else {
        base.startBinding = null;
      }
      if (rest.endBinding) {
        base.endBinding = { ...rest.endBinding, fixedPoint: rest.endBinding.fixedPoint ?? null };
      } else if (end?.id) {
        base.endBinding = { elementId: end.id, focus: 0, gap: 4, fixedPoint: null };
      } else {
        base.endBinding = null;
      }
      base.startArrowhead = rest.startArrowhead ?? null;
      base.endArrowhead = rest.endArrowhead ?? (el.type === 'arrow' ? 'arrow' : null);
      base.elbowed = rest.elbowed ?? false;
    }

    // Generate a bound text element for `label`/`text` on shapes and arrows —
    // unless the element already carries a bound text reference (a scene
    // synced from a browser tab, or a re-imported expanded export).
    const labelText = label?.text || text;
    const hasBoundText = Array.isArray(base.boundElements) &&
      base.boundElements.some((b: any) => b?.type === 'text');
    if (labelText && !hasBoundText) {
      const textId = `${base.id}-label`;
      // Add binding reference to parent
      base.boundElements = [
        ...(Array.isArray(base.boundElements) ? base.boundElements : []),
        { type: 'text', id: textId }
      ];

      // Compute text position: centered in shape, or at arrow midpoint
      let textX: number, textY: number, textW: number, textH: number;
      const isArrow = el.type === 'arrow' || el.type === 'line';

      if (isArrow) {
        // Position at midpoint of arrow path
        const pts = base.points || [[0, 0], [100, 0]];
        const lastPt = pts[pts.length - 1];
        const midX = base.x + (lastPt[0] / 2);
        const midY = base.y + (lastPt[1] / 2);
        const labelW = Math.max(labelText.length * 10, 60);
        textX = midX - labelW / 2;
        textY = midY - 12;
        textW = labelW;
        textH = 24;
      } else {
        // Center inside shape container
        const containerW = base.width ?? 160;
        const containerH = base.height ?? 80;
        textX = base.x + 10;
        textY = base.y + containerH / 4;
        textW = containerW - 20;
        textH = containerH / 2;
      }

      boundTextElements.push({
        id: textId,
        type: 'text',
        x: textX,
        y: textY,
        width: textW,
        height: textH,
        angle: 0,
        strokeColor: isArrow ? '#1e1e1e' : base.strokeColor,
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        index: `a${indexCounter++}`,
        roundness: null,
        seed: seedFor(`${textId}:seed`),
        version: 1,
        versionNonce: seedFor(`${textId}:nonce`),
        isDeleted: false,
        boundElements: null,
        updated: updatedFor(el),
        link: null,
        locked: false,
        text: labelText,
        originalText: labelText,
        fontSize: isArrow ? 14 : (rest.fontSize ?? 16),
        fontFamily: normalizeFontFamily(rest.fontFamily) ?? 1,
        textAlign: 'center',
        verticalAlign: 'middle',
        autoResize: true,
        lineHeight: 1.25,
        containerId: base.id
      });
    }

    cleanedExportElements.push(base);
  }

  // Patch shapes' boundElements to include connected arrows
  const shapeBoundArrows = new Map<string, { type: string; id: string }[]>();
  for (const el of cleanedExportElements) {
    if (el.startBinding?.elementId) {
      const arr = shapeBoundArrows.get(el.startBinding.elementId) || [];
      arr.push({ type: 'arrow', id: el.id });
      shapeBoundArrows.set(el.startBinding.elementId, arr);
    }
    if (el.endBinding?.elementId) {
      const arr = shapeBoundArrows.get(el.endBinding.elementId) || [];
      arr.push({ type: 'arrow', id: el.id });
      shapeBoundArrows.set(el.endBinding.elementId, arr);
    }
  }
  for (const el of cleanedExportElements) {
    const arrowBindings = shapeBoundArrows.get(el.id);
    if (arrowBindings) {
      // Skip refs the element already carries (re-exported expanded scenes),
      // otherwise every export cycle appends duplicate boundElements entries.
      const existing = new Set(
        (Array.isArray(el.boundElements) ? el.boundElements : []).map((b: any) => b?.id)
      );
      const additions = arrowBindings.filter(b => !existing.has(b.id));
      if (additions.length > 0) {
        el.boundElements = [
          ...(Array.isArray(el.boundElements) ? el.boundElements : []),
          ...additions
        ];
      }
    }
  }

  // Append all bound text elements after their parents
  cleanedExportElements.push(...boundTextElements);

  return deterministic ? canonicalizeKeys(cleanedExportElements) : cleanedExportElements;
}
