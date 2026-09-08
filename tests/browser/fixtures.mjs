// Issue #109's native frame shape: no skeleton-only `children` property.
const base = {
  x: 0, y: 0, width: 400, height: 300,
  strokeColor: '#1971c2', backgroundColor: 'transparent', version: 1,
  versionNonce: 1, isDeleted: false, groupIds: [], frameId: null, seed: 1,
  updated: 1, angle: 0, fillStyle: 'solid', link: null, locked: false,
  opacity: 100, roughness: 1, roundness: null, strokeStyle: 'solid', strokeWidth: 2,
};

export function frameScene() {
  return [
    { ...base, id: 'frame-repro-1', type: 'frame', name: 'repro-frame', index: 'a0' },
    ...['Hello inside frame', 'Second text inside frame'].map((text, i) => ({
      ...base, id: `text-repro-${i + 1}`, type: 'text', x: 20, y: 30 + 60 * i,
      width: 220, height: 24, text, originalText: text, fontSize: 18, fontFamily: 5,
      textAlign: 'left', verticalAlign: 'top', containerId: null, boundElements: null,
      autoResize: true, lineHeight: 1.3, frameId: 'frame-repro-1', index: `a${i + 1}`,
    })),
  ];
}

export function mixedScene() {
  return [
    { ...base, id: 'shape', type: 'rectangle', x: 450, width: 140, height: 80,
      boundElements: [{ id: 'label', type: 'text' }, { id: 'arrow', type: 'arrow' }] },
    { ...base, id: 'label', type: 'text', text: 'Bound label', originalText: 'Bound label',
      x: 460, y: 30, width: 120, height: 25, fontSize: 20, fontFamily: 5,
      textAlign: 'center', verticalAlign: 'middle', containerId: 'shape', autoResize: false, lineHeight: 1.25 },
    { ...base, id: 'image', type: 'image', x: 650, width: 30, height: 30,
      fileId: 'pixel', status: 'saved', scale: [1, 1] },
    ...frameScene(),
    { ...base, id: 'freehand', type: 'freedraw', x: 500, y: 150, width: 40, height: 20,
      points: [[0, 0], [20, 20], [40, 0]], pressures: [0.5, 0.5, 0.5], simulatePressure: false },
    { ...base, id: 'arrow', type: 'arrow', x: 591, y: 40, width: 80, height: 0,
      points: [[0, 0], [80, 0]], startBinding: { elementId: 'shape', focus: 0, gap: 1 },
      endBinding: null, endArrowhead: 'arrow', startArrowhead: null },
    { id: 'shorthand', type: 'rectangle', x: 450, y: 220, label: { text: 'Agent label' } },
  ].map((element, i) => ({ ...element, index: `a${i}` }));
}

export const pixelFile = {
  id: 'pixel', mimeType: 'image/png', created: 1,
  dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
};
