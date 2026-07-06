import path from 'path';
import { generateId, ServerElement, normalizeFontFamily } from '../types.js';
import { ALLOWED_EXPORT_DIR } from './config.js';

// Safe file path validation to prevent path traversal attacks
export function sanitizeFilePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const allowedDir = path.resolve(ALLOWED_EXPORT_DIR);
  if (!resolved.startsWith(allowedDir + path.sep) && resolved !== allowedDir) {
    throw new Error(
      `Path traversal blocked: "${filePath}" resolves outside the allowed directory "${allowedDir}". ` +
      `Set EXCALIDRAW_EXPORT_DIR to change the allowed base directory.`
    );
  }
  return resolved;
}

// Normalize points to [x, y] tuple format that Excalidraw expects
export function normalizePoints(points: Array<{ x: number; y: number } | [number, number]>): [number, number][] {
  return points.map(p => {
    if (Array.isArray(p)) return p as [number, number];
    return [p.x, p.y] as [number, number];
  });
}

// Helper function to convert text property to label format for Excalidraw
export function convertTextToLabel(element: ServerElement): ServerElement {
  const { text, ...rest } = element;
  if (text) {
    // For standalone text elements, keep text as direct property
    if (element.type === 'text') {
      return element; // Keep text as direct property
    }
    // For other elements (rectangle, ellipse, diamond), convert to label format
    return {
      ...rest,
      label: { text }
    } as ServerElement;
  }
  return element;
}

export interface ElementInput {
  id?: string;
  type: string;
  points?: Array<{ x: number; y: number } | [number, number]>;
  startElementId?: string;
  endElementId?: string;
  fontFamily?: string | number;
  [key: string]: unknown;
}

// Shared element preparation: id generation, arrow binding conversion,
// fontFamily normalization, default points for bound arrows, timestamps,
// and text→label conversion. Used by create/batch-create in both the MCP
// server and the CLI so the two front-ends produce identical elements.
export function prepareElement(elementData: ElementInput): ServerElement {
  const { startElementId, endElementId, id: customId, ...elementProps } = elementData;
  const id = customId || generateId();
  const element: ServerElement = {
    id,
    ...elementProps,
    points: elementProps.points ? normalizePoints(elementProps.points) : undefined,
    // Convert binding IDs to Excalidraw's start/end format
    ...(startElementId ? { start: { id: startElementId } } : {}),
    ...(endElementId ? { end: { id: endElementId } } : {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1
  } as ServerElement;

  // Normalize fontFamily from string names to numeric values
  if (element.fontFamily !== undefined) {
    element.fontFamily = normalizeFontFamily(element.fontFamily);
  }

  // For bound arrows without explicit points, set a default
  if ((startElementId || endElementId) && !elementProps.points) {
    (element as any).points = [[0, 0], [100, 0]];
  }

  // Convert text to label format for Excalidraw
  return convertTextToLabel(element);
}

// Shared update-payload preparation (points, fontFamily, text→label,
// updatedAt) — used by the MCP update_element tool and the CLI.
//
// `knownType` is the element's actual type as fetched from the canvas.
// Update payloads usually don't carry `type`, and text→label conversion must
// only happen for non-text elements — converting a standalone text element's
// `text` into `label` silently fails to change the visible text.
export function prepareElementUpdate(
  id: string,
  updates: Record<string, unknown>,
  knownType?: string
): Partial<ServerElement> & { id: string } {
  const { points: rawPoints, ...rest } = updates as {
    points?: Array<{ x: number; y: number } | [number, number]>;
    [key: string]: unknown;
  };

  const updatePayload: Partial<ServerElement> & { id: string } = {
    id,
    ...rest,
    points: rawPoints ? normalizePoints(rawPoints) : undefined,
    updatedAt: new Date().toISOString()
  };

  if (updatePayload.fontFamily !== undefined) {
    updatePayload.fontFamily = normalizeFontFamily(updatePayload.fontFamily);
  }

  // Convert text→label only when the element is known to be a non-text
  // shape. Unknown type keeps `text` as-is (the safe direction for text
  // elements; when the canvas is up, callers always know the type).
  const effectiveType = (updates.type as string | undefined) ?? knownType;
  if (updatePayload.text !== undefined && effectiveType && effectiveType !== 'text') {
    const { text, ...withoutText } = updatePayload;
    return { ...withoutText, label: { text } } as Partial<ServerElement> & { id: string };
  }

  return updatePayload;
}
