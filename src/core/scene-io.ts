import fs from 'fs';
import { generateId, ServerElement } from '../types.js';
import {
  getElements,
  getFiles,
  postFiles,
  batchCreateElementsOnCanvas,
  replaceElementsOnCanvas
} from './canvas-client.js';
import { sanitizeFilePath } from './normalize.js';
import { isObsidianExcalidrawMd, extractSceneJsonFromObsidianMd } from './obsidian-md.js';
import { expandElementsForExport } from './expand-elements.js';

export interface ExportedScene {
  scene: Record<string, any>;
  elementCount: number;
}

// Build a .excalidraw scene JSON from the current canvas state.
// Elements are expanded from the agent format (label/start/end) into real
// Excalidraw elements (bound text pairs, arrow bindings) so the file renders
// fully on excalidraw.com and in the Obsidian Excalidraw plugin — with
// deterministic ids/seeds so re-exporting an unchanged scene is byte-stable.
export async function buildSceneFile(): Promise<ExportedScene> {
  const sceneElements = await getElements();
  const exportElements = expandElementsForExport(sceneElements, { deterministic: true });

  // Fetch files for image elements
  let sceneFiles: Record<string, any> = {};
  try {
    sceneFiles = await getFiles();
  } catch { /* files endpoint may not exist */ }

  const excalidrawScene: Record<string, any> = {
    type: 'excalidraw',
    version: 2,
    source: 'mcp-excalidraw-server',
    elements: exportElements,
    appState: {
      viewBackgroundColor: '#ffffff',
      gridSize: null
    },
    ...(Object.keys(sceneFiles).length > 0 ? { files: sceneFiles } : {})
  };

  return { scene: excalidrawScene, elementCount: exportElements.length };
}

export interface ImportResult {
  count: number;
  fileCount: number;
  mode: 'replace' | 'merge';
}

// Import elements from a .excalidraw JSON file, an Obsidian .excalidraw.md
// file, or raw JSON data
export async function importScene(options: {
  filePath?: string;
  data?: string;
  mode: 'replace' | 'merge';
}): Promise<ImportResult> {
  let raw: string;
  if (options.filePath) {
    const safeImportPath = sanitizeFilePath(options.filePath);
    raw = fs.readFileSync(safeImportPath, 'utf-8');
  } else if (options.data) {
    raw = options.data;
  } else {
    throw new Error('Either filePath or data must be provided');
  }
  if (isObsidianExcalidrawMd(raw)) {
    raw = extractSceneJsonFromObsidianMd(raw);
  }
  const sceneData: any = JSON.parse(raw);

  // Extract elements from .excalidraw format or raw array
  const importElements: ServerElement[] = Array.isArray(sceneData)
    ? sceneData
    : (sceneData.elements || []);

  if (importElements.length === 0) {
    throw new Error('No elements found in the import data');
  }

  // Batch create the imported elements
  const elementsToCreate = importElements.map(el => ({
    ...el,
    id: el.id || generateId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1
  }));

  const created = options.mode === 'replace'
    ? await replaceElementsOnCanvas(elementsToCreate)
    : await batchCreateElementsOnCanvas(elementsToCreate);
  if (!created) {
    throw new Error('Import failed: canvas rejected the batch create');
  }

  // Import files if present (for image elements)
  let importedFileCount = 0;
  const importFiles = sceneData.files;
  if (importFiles && typeof importFiles === 'object') {
    const fileList = Object.values(importFiles);
    if (fileList.length > 0) {
      try {
        await postFiles(fileList);
        importedFileCount = fileList.length;
      } catch { /* best effort */ }
    }
  }

  return { count: elementsToCreate.length, fileCount: importedFileCount, mode: options.mode };
}
