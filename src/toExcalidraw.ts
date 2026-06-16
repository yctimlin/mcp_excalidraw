// src/toExcalidraw.ts
//
// The MCP builds elements in a convenience format that the OLD yctimlin frontend
// expanded via Excalidraw's `convertToExcalidrawElements` before rendering:
//   - a shape with `label: { text }`           -> a separate bound `text` element
//   - an arrow/line with `start`/`end: { id }`  -> startBinding/endBinding + points
//
// ExcaliDash is vanilla Excalidraw and does NOT understand `label`/`start`/`end`,
// so without this conversion box labels disappear and bound arrows don't connect.
// We port the expansion here and run it in persistScene before sending to ExcaliDash.
//
// Excalidraw's loader re-normalizes elements (fills seed/versionNonce/roundness,
// recomputes bound-text layout and bound-arrow routing), so we only need correct
// structure + reasonable geometry, not every internal field.

import { generateId, ServerElement } from './types.js';

type AnyEl = ServerElement & Record<string, any>;

const HAND_FONT = 1; // Excalidraw numeric fontFamily (hand-drawn)
const GAP = 6;

function centerOf(el: AnyEl): { x: number; y: number } {
  return { x: el.x + (el.width || 0) / 2, y: el.y + (el.height || 0) / 2 };
}

// Point on the edge of `el` along the ray toward (targetCenterX, targetCenterY).
// Ported from the old canvas server (src/server.ts computeEdgePoint).
function computeEdgePoint(el: AnyEl, targetCenterX: number, targetCenterY: number): { x: number; y: number } {
  const cx = el.x + (el.width || 0) / 2;
  const cy = el.y + (el.height || 0) / 2;
  const dx = targetCenterX - cx;
  const dy = targetCenterY - cy;

  if (el.type === 'diamond') {
    const hw = (el.width || 0) / 2;
    const hh = (el.height || 0) / 2;
    if (dx === 0 && dy === 0) return { x: cx, y: cy + hh };
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const scale = (absDx / hw + absDy / hh) > 0 ? 1 / (absDx / hw + absDy / hh) : 1;
    return { x: cx + dx * scale, y: cy + dy * scale };
  }

  if (el.type === 'ellipse') {
    const a = (el.width || 0) / 2;
    const b = (el.height || 0) / 2;
    if (dx === 0 && dy === 0) return { x: cx, y: cy + b };
    const angle = Math.atan2(dy, dx);
    return { x: cx + a * Math.cos(angle), y: cy + b * Math.sin(angle) };
  }

  // Rectangle (and default)
  const hw = (el.width || 0) / 2;
  const hh = (el.height || 0) / 2;
  if (dx === 0 && dy === 0) return { x: cx, y: cy + hh };
  const angle = Math.atan2(dy, dx);
  const tanA = Math.tan(angle);
  if (Math.abs(tanA * hw) <= hh) {
    const signX = dx >= 0 ? 1 : -1;
    return { x: cx + signX * hw, y: cy + signX * hw * tanA };
  } else {
    const signY = dy >= 0 ? 1 : -1;
    return { x: cx + signY * hh / tanA, y: cy + signY * hh };
  }
}

/**
 * Convert MCP-format elements into native Excalidraw elements.
 * Returns a NEW array; does not mutate the input store elements.
 */
export function toExcalidrawElements(input: ServerElement[]): AnyEl[] {
  // Shallow clone so we never mutate the in-memory store.
  const els: AnyEl[] = input.map((e) => ({ ...e }));
  const map = new Map<string, AnyEl>();
  els.forEach((e) => map.set(e.id, e));

  const newTextElements: AnyEl[] = [];

  // 1) Expand `label: { text }` into a bound text element.
  for (const el of els) {
    const label = (el as any).label;
    const isContainer = el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond';
    if (label && typeof label.text === 'string' && isContainer) {
      const textId = generateId();
      const fontSize = (el as any).fontSize || 16;
      const lines = String(label.text).split('\n');
      const longest = Math.max(...lines.map((l) => l.length), 1);
      const width = Math.max(20, Math.min((el.width || 0) - 10, longest * fontSize * 0.6));
      const height = lines.length * fontSize * 1.25;
      const c = centerOf(el);

      newTextElements.push({
        id: textId,
        type: 'text',
        x: c.x - width / 2,
        y: c.y - height / 2,
        width,
        height,
        text: label.text,
        originalText: label.text,
        fontSize,
        fontFamily: typeof (el as any).fontFamily === 'number' ? (el as any).fontFamily : HAND_FONT,
        textAlign: 'center',
        verticalAlign: 'middle',
        containerId: el.id,
        strokeColor: (el as any).strokeColor || '#1e1e1e',
        boundElements: null,
      } as AnyEl);

      const existing = Array.isArray(el.boundElements) ? el.boundElements : [];
      el.boundElements = [...existing, { type: 'text', id: textId }];
    }
    // Always strip the non-standard `label` so it doesn't confuse Excalidraw.
    if ((el as any).label) delete (el as any).label;
  }

  // 2) Resolve `start`/`end` refs into real arrow bindings + points.
  for (const el of els) {
    if (el.type !== 'arrow' && el.type !== 'line') continue;
    const startRef = (el as any).start as { id: string } | undefined;
    const endRef = (el as any).end as { id: string } | undefined;
    if (!startRef && !endRef) continue;

    const startEl = startRef ? map.get(startRef.id) : undefined;
    const endEl = endRef ? map.get(endRef.id) : undefined;

    const startCenter = startEl ? centerOf(startEl) : { x: el.x, y: el.y };
    const endCenter = endEl ? centerOf(endEl) : { x: el.x + 100, y: el.y };

    const startPt = startEl ? computeEdgePoint(startEl, endCenter.x, endCenter.y) : startCenter;
    const endPt = endEl ? computeEdgePoint(endEl, startCenter.x, startCenter.y) : endCenter;

    const sdx = endPt.x - startPt.x;
    const sdy = endPt.y - startPt.y;
    const sdist = Math.hypot(sdx, sdy) || 1;
    const edx = startPt.x - endPt.x;
    const edy = startPt.y - endPt.y;
    const edist = Math.hypot(edx, edy) || 1;

    const fStart = { x: startPt.x + (sdx / sdist) * GAP, y: startPt.y + (sdy / sdist) * GAP };
    const fEnd = { x: endPt.x + (edx / edist) * GAP, y: endPt.y + (edy / edist) * GAP };

    el.x = fStart.x;
    el.y = fStart.y;
    el.points = [[0, 0], [fEnd.x - fStart.x, fEnd.y - fStart.y]];

    if (startEl) {
      el.startBinding = { elementId: startEl.id, focus: 0, gap: GAP };
      const existing = Array.isArray(startEl.boundElements) ? startEl.boundElements : [];
      startEl.boundElements = [...existing, { type: 'arrow', id: el.id }];
    }
    if (endEl) {
      el.endBinding = { elementId: endEl.id, focus: 0, gap: GAP };
      const existing = Array.isArray(endEl.boundElements) ? endEl.boundElements : [];
      endEl.boundElements = [...existing, { type: 'arrow', id: el.id }];
    }

    delete (el as any).start;
    delete (el as any).end;
  }

  return [...els, ...newTextElements];
}
