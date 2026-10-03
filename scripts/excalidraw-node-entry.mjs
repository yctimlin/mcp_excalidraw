// Entry point for the Node bundle of Excalidraw's exporter (see
// scripts/build-excalidraw-node.mjs). Kept outside src/ so tsc never emits an
// unbundled copy that would import @excalidraw/excalidraw directly at runtime.
//
// Only what the headless renderer needs is re-exported; esbuild tree-shakes
// the rest of the editor. The scene preparation is the canvas tab's own code
// (frontend/src/utils/scene.ts), so headless renders see exactly the scene
// the tab shows: same label sizing and centering, same defaults.
export {
  exportToSvg,
  restoreElements,
  getCommonBounds,
  FONT_FAMILY
} from '@excalidraw/excalidraw';
export { prepareServerScene, cleanElementForExcalidraw } from '../frontend/src/utils/scene.ts';
