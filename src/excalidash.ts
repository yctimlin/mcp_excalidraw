// src/excalidash.ts
const BASE = (process.env.EXCALIDASH_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const TOKEN = process.env.EXCALIDASH_TOKEN || '';

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (TOKEN) h['Authorization'] = `Bearer ${TOKEN}`;
  return h;
}

export interface DrawingSummary { id: string; name: string; version: number; updatedAt: string; }
export interface FullDrawing { id: string; name: string; version: number; elements: any[]; appState: Record<string, unknown>; files: Record<string, unknown>; }

export async function createDrawing(name: string, elements: any[], appState: Record<string, unknown>, files: Record<string, unknown>): Promise<FullDrawing> {
  const res = await fetch(`${BASE}/drawings`, { method: 'POST', headers: headers(), body: JSON.stringify({ name, elements, appState, files }) });
  if (!res.ok) throw new Error(`ExcaliDash createDrawing failed: ${res.status} ${await res.text()}`);
  return await res.json() as FullDrawing;
}

export async function updateDrawing(id: string, elements: any[], appState: Record<string, unknown>, files: Record<string, unknown>): Promise<FullDrawing> {
  const res = await fetch(`${BASE}/drawings/${id}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ elements, appState, files }) });
  if (!res.ok) throw new Error(`ExcaliDash updateDrawing failed: ${res.status} ${await res.text()}`);
  return await res.json() as FullDrawing;
}

export async function listDrawings(): Promise<DrawingSummary[]> {
  const res = await fetch(`${BASE}/drawings`, { headers: headers() });
  if (!res.ok) throw new Error(`ExcaliDash listDrawings failed: ${res.status} ${await res.text()}`);
  const body = await res.json() as { drawings: DrawingSummary[] };
  return body.drawings ?? [];
}

export async function getDrawing(id: string): Promise<FullDrawing> {
  const res = await fetch(`${BASE}/drawings/${id}`, { headers: headers() });
  if (!res.ok) throw new Error(`ExcaliDash getDrawing failed: ${res.status} ${await res.text()}`);
  return await res.json() as FullDrawing;
}

export function excalidashBase(): string { return BASE; }
