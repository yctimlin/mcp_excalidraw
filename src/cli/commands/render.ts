import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseArgs, CliUsageError, readStdin } from '../args.js';
import { printJson, note } from '../util.js';
import { IMAGE_FLAG_SPEC, imageFormatFromFlags, imageOptionsFromFlags } from '../image-options.js';
import { isObsidianExcalidrawMd, extractSceneJsonFromObsidianMd } from '../../core/obsidian-md.js';
import { renderScene } from '../../core/render/index.js';

// Render a scene file to PNG/SVG without a canvas server — for CI pipelines
// that turn committed .excalidraw files into images, or for checking a file
// an agent just wrote. Accepts .excalidraw JSON, Obsidian .excalidraw.md, a
// bare element array, or `-` for stdin.

export async function render(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv, IMAGE_FLAG_SPEC);
  if ((flags.renderer as string | undefined) === 'browser') {
    throw new CliUsageError('render works offline; use `screenshot --renderer browser` for tab rendering');
  }

  const input = positionals[0];
  let raw = input && input !== '-' ? fs.readFileSync(path.resolve(input), 'utf-8') : await readStdin();
  if (!raw.trim()) {
    throw new CliUsageError('No scene provided (pass a .excalidraw / .excalidraw.md file or pipe JSON to stdin)');
  }
  if (isObsidianExcalidrawMd(raw)) raw = extractSceneJsonFromObsidianMd(raw);

  let sceneData: any;
  try {
    sceneData = JSON.parse(raw);
  } catch (error) {
    throw new CliUsageError(`Invalid scene JSON: ${(error as Error).message}`);
  }
  const sourceElements = Array.isArray(sceneData) ? sceneData : sceneData?.elements;
  if (!Array.isArray(sourceElements) || sourceElements.length === 0) {
    throw new CliUsageError('No elements found in the scene');
  }

  const format = imageFormatFromFlags(flags);
  const options = imageOptionsFromFlags(flags, format);
  const scene = {
    // Agent-format (label/start/end) and native elements are both accepted;
    // the renderer prepares them the way the canvas tab does.
    elements: sourceElements,
    files: (sceneData && !Array.isArray(sceneData) && sceneData.files) || {}
  };

  const result = await renderScene(scene, options);
  for (const warning of result.warnings) note(`warning: ${warning}`);

  let outPath = flags.out as string | undefined;
  if (!outPath && format === 'svg') {
    process.stdout.write(result.data + '\n');
    return;
  }
  if (!outPath) {
    const stem = input && input !== '-' ? path.basename(input).replace(/\.excalidraw(\.md)?$|\.json$/i, '') : 'scene';
    outPath = path.join(os.tmpdir(), `${stem}-${Date.now()}.png`);
  }

  const resolved = path.resolve(outPath);
  if (format === 'svg') {
    fs.writeFileSync(resolved, result.data, 'utf-8');
  } else {
    fs.writeFileSync(resolved, Buffer.from(result.data, 'base64'));
  }
  printJson({ success: true, file: resolved, format, renderer: 'node', width: result.width, height: result.height, elements: scene.elements.length });
}
