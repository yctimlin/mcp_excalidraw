import fs from 'fs';
import { generateId, ServerElement } from '../types.js';
import {
  getElements,
  getFiles,
  postFiles,
  clearCanvas,
  batchCreateElementsOnCanvas
} from './canvas-client.js';
import { sanitizeFilePath } from './normalize.js';
import { isObsidianExcalidrawMd, extractSceneJsonFromObsidianMd } from './obsidian-md.js';

export interface ExportedScene {
  scene: Record<string, any>;
  elementCount: number;
}

// Build a .excalidraw scene JSON from the current canvas state
export async function buildSceneFile(): Promise<ExportedScene> {
  const sceneElements = await getElements();

  // Fetch files for image elements
  let sceneFiles: Record<string, any> = {};
  try {
    sceneFiles = await getFiles();
  } catch { /* files endpoint may not exist */ }

  const excalidrawScene: Record<string, any> = {
    type: 'excalidraw',
    version: 2,
    source: 'mcp-excalidraw-server',
    elements: sceneElements,
    appState: {
      viewBackgroundColor: '#ffffff',
      gridSize: null
    },
    ...(Object.keys(sceneFiles).length > 0 ? { files: sceneFiles } : {})
  };

  return { scene: excalidrawScene, elementCount: sceneElements.length };
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

  // If replace mode, clear first
  if (options.mode === 'replace') {
    await clearCanvas();
  }

  // Batch create the imported elements
  const elementsToCreate = importElements.map(el => ({
    ...el,
    id: el.id || generateId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1
  }));

  const created = await batchCreateElementsOnCanvas(elementsToCreate);
  if (!created) {
    // Especially important in replace mode: the canvas was already cleared,
    // so a silently swallowed failure here would report success on data loss
    throw new Error('Import failed: canvas rejected the batch create (elements were not restored)');
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
