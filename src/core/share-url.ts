import { deflateSync } from 'zlib';
import { webcrypto } from 'crypto';
import { ServerElement, normalizeFontFamily } from '../types.js';

// Excalidraw's concatBuffers: [4-byte version=1][4-byte len][chunk]...
function concatBuffers(...bufs: Uint8Array[]): Uint8Array {
  let total = 4; // version header
  for (const b of bufs) total += 4 + b.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 1); // CONCAT_BUFFERS_VERSION = 1
  let off = 4;
  for (const b of bufs) {
    dv.setUint32(off, b.length);
    off += 4;
    out.set(b, off);
    off += b.length;
  }
  return out;
}

// Clean elements for excalidraw.com: strip server metadata, add Excalidraw
// defaults, generate bound text elements, and resolve arrow bindings.
function cleanElementsForShare(urlExportElements: ServerElement[]): Record<string, any>[] {
  const cleanedExportElements: Record<string, any>[] = [];
  const boundTextElements: Record<string, any>[] = [];
  let indexCounter = 0;

  function makeBaseElement(el: any, rest: any): Record<string, any> {
    return {
      ...rest,
      angle: rest.angle ?? 0,
      strokeColor: rest.strokeColor ?? '#1e1e1e',
      backgroundColor: rest.backgroundColor ?? 'transparent',
      fillStyle: rest.fillStyle ?? 'solid',
      strokeWidth: rest.strokeWidth ?? 2,
      strokeStyle: rest.strokeStyle ?? 'solid',
      roughness: rest.roughness ?? 1,
      opacity: rest.opacity ?? 100,
      groupIds: rest.groupIds ?? [],
      frameId: rest.frameId ?? null,
      index: rest.index ?? `a${indexCounter++}`,
      roundness: rest.roundness ?? (
        el.type === 'rectangle' || el.type === 'diamond' || el.type === 'ellipse'
          ? { type: 3 } : null
      ),
      seed: rest.seed ?? Math.floor(Math.random() * 2147483647),
      version: rest.version ?? 1,
      versionNonce: rest.versionNonce ?? Math.floor(Math.random() * 2147483647),
      isDeleted: false,
      boundElements: rest.boundElements ?? null,
      updated: Date.now(),
      link: rest.link ?? null,
      locked: rest.locked ?? false
    };
  }

  for (const el of urlExportElements) {
    // Strip server-only fields
    const {
      createdAt, updatedAt, syncedAt, source: _src,
      syncTimestamp, label, start, end, text,
      version: _ver,
      ...rest
    } = el as any;

    const base = makeBaseElement(el, rest);

    // Standalone text elements: keep text directly
    if (el.type === 'text') {
      base.text = text ?? '';
      base.originalText = text ?? '';
      base.fontSize = rest.fontSize ?? 20;
      base.fontFamily = normalizeFontFamily(rest.fontFamily) ?? 1;
      base.textAlign = rest.textAlign ?? 'center';
      base.verticalAlign = rest.verticalAlign ?? 'middle';
      base.autoResize = rest.autoResize ?? true;
      base.lineHeight = rest.lineHeight ?? 1.25;
      base.containerId = rest.containerId ?? null;
      cleanedExportElements.push(base);
      continue;
    }

    // Arrows: server already resolved bindings (start/end → startBinding/endBinding + positions)
    if (el.type === 'arrow' || el.type === 'line') {
      base.points = rest.points ?? [[0, 0], [100, 0]];
      base.lastCommittedPoint = null;
      // Preserve server-resolved bindings with fixedPoint for excalidraw.com
      if (rest.startBinding) {
        base.startBinding = { ...rest.startBinding, fixedPoint: rest.startBinding.fixedPoint ?? null };
      } else {
        base.startBinding = null;
      }
      if (rest.endBinding) {
        base.endBinding = { ...rest.endBinding, fixedPoint: rest.endBinding.fixedPoint ?? null };
      } else {
        base.endBinding = null;
      }
      base.startArrowhead = rest.startArrowhead ?? null;
      base.endArrowhead = rest.endArrowhead ?? (el.type === 'arrow' ? 'arrow' : null);
      base.elbowed = rest.elbowed ?? false;
    }

    // Generate bound text element for label on shapes and arrows
    const labelText = label?.text || text;
    if (labelText) {
      const textId = `${base.id}-label`;
      // Add binding reference to parent
      base.boundElements = [
        ...(Array.isArray(base.boundElements) ? base.boundElements : []),
        { type: 'text', id: textId }
      ];

      // Compute text position: centered in shape, or at arrow midpoint
      let textX: number, textY: number, textW: number, textH: number;
      const isArrow = el.type === 'arrow' || el.type === 'line';

      if (isArrow) {
        // Position at midpoint of arrow path
        const pts = base.points || [[0, 0], [100, 0]];
        const lastPt = pts[pts.length - 1];
        const midX = base.x + (lastPt[0] / 2);
        const midY = base.y + (lastPt[1] / 2);
        const labelW = Math.max(labelText.length * 10, 60);
        textX = midX - labelW / 2;
        textY = midY - 12;
        textW = labelW;
        textH = 24;
      } else {
        // Center inside shape container
        const containerW = base.width ?? 160;
        const containerH = base.height ?? 80;
        textX = base.x + 10;
        textY = base.y + containerH / 4;
        textW = containerW - 20;
        textH = containerH / 2;
      }

      boundTextElements.push({
        id: textId,
        type: 'text',
        x: textX,
        y: textY,
        width: textW,
        height: textH,
        angle: 0,
        strokeColor: isArrow ? '#1e1e1e' : base.strokeColor,
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        index: `a${indexCounter++}`,
        roundness: null,
        seed: Math.floor(Math.random() * 2147483647),
        version: 1,
        versionNonce: Math.floor(Math.random() * 2147483647),
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
        text: labelText,
        originalText: labelText,
        fontSize: isArrow ? 14 : (rest.fontSize ?? 16),
        fontFamily: normalizeFontFamily(rest.fontFamily) ?? 1,
        textAlign: 'center',
        verticalAlign: 'middle',
        autoResize: true,
        lineHeight: 1.25,
        containerId: base.id
      });
    }

    cleanedExportElements.push(base);
  }

  // Patch shapes' boundElements to include connected arrows
  const shapeBoundArrows = new Map<string, { type: string; id: string }[]>();
  for (const el of cleanedExportElements) {
    if (el.startBinding?.elementId) {
      const arr = shapeBoundArrows.get(el.startBinding.elementId) || [];
      arr.push({ type: 'arrow', id: el.id });
      shapeBoundArrows.set(el.startBinding.elementId, arr);
    }
    if (el.endBinding?.elementId) {
      const arr = shapeBoundArrows.get(el.endBinding.elementId) || [];
      arr.push({ type: 'arrow', id: el.id });
      shapeBoundArrows.set(el.endBinding.elementId, arr);
    }
  }
  for (const el of cleanedExportElements) {
    const arrowBindings = shapeBoundArrows.get(el.id);
    if (arrowBindings) {
      el.boundElements = [
        ...(Array.isArray(el.boundElements) ? el.boundElements : []),
        ...arrowBindings
      ];
    }
  }

  // Append all bound text elements after their parents
  cleanedExportElements.push(...boundTextElements);

  return cleanedExportElements;
}

// Export elements to a shareable excalidraw.com URL. The diagram is
// encrypted client-side (AES-GCM 128) and uploaded; the decryption key only
// lives in the URL fragment.
export async function exportToExcalidrawUrl(urlExportElements: ServerElement[]): Promise<string> {
  if (urlExportElements.length === 0) {
    throw new Error('Canvas is empty — nothing to export');
  }

  const cleanedExportElements = cleanElementsForShare(urlExportElements);

  // Build .excalidraw scene JSON
  const excalidrawScene = {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: cleanedExportElements,
    appState: {
      viewBackgroundColor: '#ffffff',
      gridSize: null
    },
    files: {}
  };
  const sceneJson = JSON.stringify(excalidrawScene);
  const dataBytes = new TextEncoder().encode(sceneJson);

  const encoder = new TextEncoder();

  // Inner data: concatBuffers(fileMetadata, dataJSON)
  const fileMetadata = encoder.encode('{}');
  const innerData = concatBuffers(fileMetadata, dataBytes);

  // Compress with zlib deflate
  const compressed = deflateSync(Buffer.from(innerData));

  // Encrypt with AES-GCM 128-bit key
  const cryptoKey = await webcrypto.subtle.generateKey(
    { name: 'AES-GCM', length: 128 },
    true,
    ['encrypt']
  );

  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encrypted = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    compressed
  );

  // Outer payload: concatBuffers(encodingMeta, iv, ciphertext)
  const encodingMeta = encoder.encode(JSON.stringify({
    version: 2,
    compression: 'pako@1',
    encryption: 'AES-GCM'
  }));
  const ciphertext = new Uint8Array(encrypted);
  const payload = concatBuffers(encodingMeta, iv, ciphertext);

  // POST to excalidraw.com JSON store
  const uploadResponse = await fetch('https://json.excalidraw.com/api/v2/post/', {
    method: 'POST',
    body: Buffer.from(payload)
  });

  if (!uploadResponse.ok) {
    throw new Error(`Upload to excalidraw.com failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
  }

  const uploadResult = await uploadResponse.json() as { id: string };

  // Export key as JWK to get the "k" field
  const jwk = await webcrypto.subtle.exportKey('jwk', cryptoKey);

  // Build shareable URL
  return `https://excalidraw.com/#json=${uploadResult.id},${jwk.k}`;
}
