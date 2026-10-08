import { isPng, extractPngScene } from './png-scene.js';
import { isObsidianExcalidrawMd, extractSceneJsonFromObsidianMd } from './obsidian-md.js';

// Decode file bytes before parsing JSON; raw data remains a text-only input.
export function decodeSceneInput(input: Buffer | string): string {
  if (Buffer.isBuffer(input) && isPng(input)) {
    return extractPngScene(input);
  }
  const text = typeof input === 'string' ? input : input.toString('utf-8');
  return isObsidianExcalidrawMd(text) ? extractSceneJsonFromObsidianMd(text) : text;
}
