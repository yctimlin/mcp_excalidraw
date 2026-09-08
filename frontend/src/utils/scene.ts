import { convertToExcalidrawElements, restoreElements } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

export interface ServerElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  roughness?: number;
  opacity?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string | number;
  label?: {
    text: string;
  };
  createdAt?: string;
  updatedAt?: string;
  version?: number;
  syncedAt?: string;
  source?: string;
  syncTimestamp?: string;
  boundElements?: readonly any[] | null;
  containerId?: string | null;
  locked?: boolean;
  // Arrow element binding
  start?: { id: string };
  end?: { id: string };
  strokeStyle?: string;
  endArrowhead?: string;
  startArrowhead?: string;
  // Image element fields
  fileId?: string;
  status?: string;
  scale?: [number, number];
  angle?: number;
  link?: string | null;
  frameId?: string | null;
  name?: string | null;
}

// Helper function to clean elements for Excalidraw
export const cleanElementForExcalidraw = (element: ServerElement): Partial<ExcalidrawElement> => {
  const {
    createdAt,
    updatedAt,
    syncedAt,
    source,
    syncTimestamp,
    ...cleanElement
  } = element;
  return cleanElement as Partial<ExcalidrawElement>;
}

// Helper function to validate and fix element binding data
const validateAndFixBindings = (elements: Partial<ExcalidrawElement>[]): Partial<ExcalidrawElement>[] => {
  const elementMap = new Map(elements.map(el => [el.id!, el]));

  return elements.map(element => {
    const fixedElement = { ...element };

    // Validate and fix boundElements
    if (fixedElement.boundElements) {
      if (Array.isArray(fixedElement.boundElements)) {
        fixedElement.boundElements = fixedElement.boundElements.filter((binding: any) => {
          // Ensure binding has required properties
          if (!binding || typeof binding !== 'object') return false;
          if (!binding.id || !binding.type) return false;

          // Ensure the referenced element exists
          const referencedElement = elementMap.get(binding.id);
          if (!referencedElement) return false;

          // Validate binding type
          if (!['text', 'arrow'].includes(binding.type)) return false;

          return true;
        });

        // Remove boundElements if empty
        if (fixedElement.boundElements.length === 0) {
          fixedElement.boundElements = null;
        }
      } else {
        // Invalid boundElements format, set to null
        fixedElement.boundElements = null;
      }
    }

    // Validate and fix containerId
    if (fixedElement.type === 'text' && fixedElement.containerId) {
      const containerElement = elementMap.get(fixedElement.containerId);
      if (!containerElement) {
        // Container doesn't exist, remove containerId
        fixedElement.containerId = null;
      }
    }

    return fixedElement;
  });
}

const isImageElement = (element: Partial<ExcalidrawElement>): boolean => {
  return element.type === 'image'
}

const isFreedrawElement = (element: Partial<ExcalidrawElement>): boolean => {
  return element.type === 'freedraw'
}

const isShapeContainerType = (type: string | undefined): boolean => {
  return type === 'rectangle' || type === 'ellipse' || type === 'diamond'
}

const recenterBoundShapeTextElements = (
  elements: Partial<ExcalidrawElement>[]
): Partial<ExcalidrawElement>[] => {
  const elementMap = new Map(elements.map((el) => [el.id, el]))

  return elements.map((element) => {
    if (element.type !== 'text' || !element.containerId) {
      return element
    }

    const textElement = element as ExcalidrawElement & { type: 'text'; containerId: string; autoResize?: boolean }
    const container = elementMap.get(textElement.containerId) as (ExcalidrawElement & { x: number; y: number; width: number; height: number }) | undefined
    if (!container || !isShapeContainerType(container.type)) {
      return element
    }

    if (textElement.autoResize === false) {
      return element
    }

    if (
      typeof container.x !== 'number' ||
      typeof container.y !== 'number' ||
      typeof container.width !== 'number' ||
      typeof container.height !== 'number' ||
      typeof textElement.width !== 'number' ||
      typeof textElement.height !== 'number'
    ) {
      return element
    }

    return {
      ...element,
      x: container.x + (container.width - textElement.width) / 2,
      y: container.y + (container.height - textElement.height) / 2,
    }
  })
}

const normalizeImageElement = (element: Partial<ExcalidrawElement>): Partial<ExcalidrawElement> => {
  const img = element as any
  return {
    ...img,
    angle: img.angle || 0,
    strokeColor: img.strokeColor || 'transparent',
    backgroundColor: img.backgroundColor || 'transparent',
    fillStyle: img.fillStyle || 'solid',
    strokeWidth: img.strokeWidth || 1,
    strokeStyle: img.strokeStyle || 'solid',
    roughness: img.roughness ?? 0,
    opacity: img.opacity ?? 100,
    groupIds: img.groupIds || [],
    roundness: null,
    seed: img.seed || Math.floor(Math.random() * 1000000),
    version: img.version || 1,
    versionNonce: img.versionNonce || Math.floor(Math.random() * 1000000),
    isDeleted: img.isDeleted ?? false,
    boundElements: img.boundElements || null,
    link: img.link || null,
    locked: img.locked || false,
    status: img.status || 'saved',
    fileId: img.fileId,
    scale: img.scale || [1, 1],
  }
}

const normalizeFreedrawElement = (element: Partial<ExcalidrawElement>): Partial<ExcalidrawElement> => {
  const freedraw = element as any
  return {
    ...freedraw,
    angle: freedraw.angle || 0,
    backgroundColor: freedraw.backgroundColor || 'transparent',
    fillStyle: freedraw.fillStyle || 'solid',
    strokeWidth: freedraw.strokeWidth || 1,
    strokeStyle: freedraw.strokeStyle || 'solid',
    roughness: freedraw.roughness ?? 1,
    opacity: freedraw.opacity ?? 100,
    groupIds: freedraw.groupIds || [],
    roundness: null,
    seed: freedraw.seed || Math.floor(Math.random() * 1000000),
    version: freedraw.version || 1,
    versionNonce: freedraw.versionNonce || Math.floor(Math.random() * 1000000),
    isDeleted: freedraw.isDeleted ?? false,
    boundElements: freedraw.boundElements || null,
    link: freedraw.link || null,
    locked: freedraw.locked || false,
    points: freedraw.points || [],
    pressures: freedraw.pressures || [],
    simulatePressure: freedraw.simulatePressure ?? true,
    lastCommittedPoint: freedraw.lastCommittedPoint || null,
  }
}

// Helper: restore startBinding/endBinding/boundElements after convertToExcalidrawElements strips them
const restoreBindings = (
  convertedElements: readonly any[],
  originalElements: Partial<ExcalidrawElement>[]
): any[] => {
  const originalMap = new Map<string, any>();
  for (const el of originalElements) {
    if (el.id) originalMap.set(el.id, el);
  }

  return convertedElements.map((el: any) => {
    const orig = originalMap.get(el.id);
    if (!orig) return el;

    const patched = { ...el };

    if (orig.startBinding && !el.startBinding) {
      patched.startBinding = orig.startBinding;
    }
    if (orig.endBinding && !el.endBinding) {
      patched.endBinding = orig.endBinding;
    }
    if (orig.boundElements && (!el.boundElements || el.boundElements.length === 0)) {
      patched.boundElements = orig.boundElements;
    }
    if (orig.elbowed !== undefined && el.elbowed === undefined) {
      patched.elbowed = orig.elbowed;
    }

    return patched;
  });
};

const isFrame = (element: Partial<ExcalidrawElement>): element is Partial<Extract<ExcalidrawElement, { type: 'frame' | 'magicframe' }>> =>
  element.type === 'frame' || element.type === 'magicframe'

// A successful restore may still silently discard an unsupported or tiny
// element. Never allow that partial scene to become a full-sync baseline.
export const assertScenePreserved = (
  expected: readonly Partial<ExcalidrawElement>[],
  actual: readonly Partial<ExcalidrawElement>[]
): void => {
  const active = actual.filter(el => !el.isDeleted)
  const actualById = new Map(active.map(el => [el.id, el]))
  if (actualById.size !== active.length) throw new Error('Scene restore produced duplicate element IDs')
  for (const element of expected) {
    if (element.isDeleted) continue
    const restored = actualById.get(element.id)
    if (!restored || restored.type !== element.type) {
      throw new Error(`Scene restore lost element ${element.id} (${element.type})`)
    }
    if ((element.frameId ?? null) !== (restored.frameId ?? null)) {
      throw new Error(`Scene restore changed frame membership for ${element.id}`)
    }
    if (element.frameId && !isFrame(actualById.get(element.frameId) || {})) {
      throw new Error(`Missing frame ${element.frameId} for ${element.id}`)
    }
    if (isFrame(element) && isFrame(restored)) {
      for (const key of ['x', 'y', 'width', 'height', 'name'] as const) {
        if (element[key] !== undefined && element[key] !== restored[key]) {
          throw new Error(`Scene restore changed frame ${element.id}.${key}`)
        }
      }
    }
  }
}

export const prepareServerScene = (
  elements: readonly Partial<ExcalidrawElement>[]
): ExcalidrawElement[] => {
  if (!Array.isArray(elements)) throw new Error('Expected a scene element array')
  const ids = new Set<string>()
  for (const element of elements) {
    if (!element || typeof element.id !== 'string' || !element.id ||
        typeof element.type !== 'string' || ids.has(element.id)) {
      throw new Error('Scene contains an invalid or duplicate element ID')
    }
    ids.add(element.id)
    if (!Number.isFinite(element.x) || !Number.isFinite(element.y) ||
        (element.width !== undefined && !Number.isFinite(element.width)) ||
        (element.height !== undefined && !Number.isFinite(element.height))) {
      throw new Error(`Scene contains invalid coordinates for ${element.id}`)
    }
  }

  const validated = validateAndFixBindings([...elements])
  // Native frames express membership through the children's frameId. The
  // skeleton converter instead requires frame.children and recalculates bounds.
  const skeletons = validated.filter(el => !isFrame(el) && !isImageElement(el) && !isFreedrawElement(el))
  const converted = restoreBindings(
    convertToExcalidrawElements(skeletons as any, { regenerateIds: false }),
    skeletons
  )
  const convertedById = new Map(converted.map(el => [el.id, el]))
  const generatedText = new Map<string, ExcalidrawElement[]>()
  for (const element of converted) {
    if (!ids.has(element.id) && element.type === 'text' && element.containerId) {
      const siblings = generatedText.get(element.containerId) || []
      siblings.push(element)
      generatedText.set(element.containerId, siblings)
    }
  }

  // Preserve the original stacking order, including interleaved frames, images
  // and freehand strokes. Newly expanded labels sit beside their container.
  const ordered = validated.flatMap(element => {
    const next = isFrame(element) ? element
      : isImageElement(element) ? normalizeImageElement(element)
      : isFreedrawElement(element) ? normalizeFreedrawElement(element)
      : convertedById.get(element.id)
    if (!next) throw new Error(`Scene conversion lost element ${element.id}`)
    return [next, ...(generatedText.get(element.id!) || [])]
  })
  const restored = restoreElements(
    recenterBoundShapeTextElements(ordered) as ExcalidrawElement[],
    null,
    { repairBindings: true }
  )
  assertScenePreserved(elements, restored)
  return restored
}
