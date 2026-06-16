// src/sceneStore.ts
import type { ServerElement } from './types.js';

const elements = new Map<string, ServerElement>();
let currentDrawingId: string | null = null;
let drawingName = 'AI Drawing';

export const sceneStore = {
  add(el: ServerElement) { elements.set(el.id, el); return el; },
  addMany(els: ServerElement[]) { for (const el of els) elements.set(el.id, el); return els; },
  update(id: string, patch: Partial<ServerElement>) {
    const existing = elements.get(id);
    if (!existing) return null;
    const merged = { ...existing, ...patch, id } as ServerElement;
    elements.set(id, merged);
    return merged;
  },
  remove(id: string) { return elements.delete(id); },
  get(id: string) { return elements.get(id) ?? null; },
  all(): ServerElement[] { return Array.from(elements.values()); },
  clear() { elements.clear(); },
  load(els: ServerElement[]) { elements.clear(); for (const el of els) elements.set(el.id, el); },
  get drawingId() { return currentDrawingId; },
  set drawingId(v: string | null) { currentDrawingId = v; },
  get name() { return drawingName; },
  set name(v: string) { drawingName = v; },
};

export const DEFAULT_APP_STATE = { viewBackgroundColor: '#ffffff', gridSize: null };
