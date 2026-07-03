/**
 * Portable-export conversion: turn this server's internal element
 * representation into elements every standard Excalidraw viewer can render.
 *
 * Two internal conventions break portability if exported as-is:
 *
 * 1. Shape/arrow labels are stored as a `label: { text }` property. Only
 *    @excalidraw/excalidraw's convertToExcalidrawElements understands that
 *    skeleton form — excalidraw.com, VS Code viewers, etc. silently drop it,
 *    so exported boxes lose all their text.
 * 2. Text elements created while no browser tab was connected have
 *    width/height 0 (text is normally measured by the canvas in the browser).
 *    Standard viewers render zero-size text as invisible.
 *
 * When a browser tab IS connected its converted scene is synced back and
 * exports are already portable; this module makes exports correct even when
 * no tab was ever attached, using a font-metrics approximation (Excalifont
 * averages ~0.6em per character, 1.25 line-height). Slight centering error is
 * acceptable — viewers re-layout bound text on edit.
 */

const CHAR_WIDTH_EM = 0.6;
const LINE_HEIGHT = 1.25;
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_FONT_FAMILY = 5; // Excalifont

interface AnyElement { [key: string]: any }

function estimateTextSize(text: string, fontSize: number): { width: number; height: number } {
  const lines = String(text).split('\n');
  const maxLineLength = Math.max(1, ...lines.map(line => line.length));
  return {
    width: Math.ceil(maxLineLength * fontSize * CHAR_WIDTH_EM),
    height: Math.ceil(lines.length * fontSize * LINE_HEIGHT)
  };
}

function textElementDefaults(): AnyElement {
  return {
    angle: 0,
    strokeWidth: 1,
    strokeStyle: 'solid',
    fillStyle: 'solid',
    backgroundColor: 'transparent',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 0,
    link: null,
    locked: false,
    autoResize: true,
    lineHeight: LINE_HEIGHT
  };
}

/** Fill in measured-ish dimensions and required text props on a standalone text element. */
function normalizeStandaloneText(element: AnyElement): AnyElement {
  const fontSize = element.fontSize || DEFAULT_FONT_SIZE;
  const needsSize = !element.width || !element.height;
  const size = needsSize ? estimateTextSize(element.text || '', fontSize) : null;
  return {
    ...textElementDefaults(),
    ...element,
    ...(size ? { width: size.width, height: size.height } : {}),
    fontSize,
    fontFamily: element.fontFamily ?? DEFAULT_FONT_FAMILY,
    textAlign: element.textAlign || 'left',
    verticalAlign: element.verticalAlign || 'top',
    containerId: element.containerId ?? null,
    originalText: element.originalText || element.text || '',
    lineHeight: element.lineHeight || LINE_HEIGHT
  };
}

/** Build the bound text element for a container's `label` property. */
function labelToBoundText(container: AnyElement): AnyElement {
  const label = container.label || {};
  const text = String(label.text ?? '');
  const fontSize = label.fontSize || container.fontSize || DEFAULT_FONT_SIZE;
  const size = estimateTextSize(text, fontSize);
  const containerWidth = container.width || size.width;
  const containerHeight = container.height || size.height;
  const width = Math.min(size.width, Math.max(20, containerWidth - 20));
  const height = size.height;

  return {
    ...textElementDefaults(),
    id: `${container.id}__label`,
    type: 'text',
    x: container.x + (containerWidth - width) / 2,
    y: container.y + (containerHeight - height) / 2,
    width,
    height,
    text,
    originalText: text,
    fontSize,
    fontFamily: label.fontFamily || container.fontFamily || DEFAULT_FONT_FAMILY,
    strokeColor: label.strokeColor || container.strokeColor || '#1e1e1e',
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: container.id
  };
}

/**
 * Convert internal elements to standard Excalidraw elements:
 * expand `label` properties into bound text children and give zero-size text
 * elements estimated dimensions. Elements that are already standard pass
 * through unchanged.
 */
export function toPortableElements(elements: AnyElement[]): AnyElement[] {
  const result: AnyElement[] = [];

  for (const element of elements) {
    if (element.type === 'text') {
      result.push(normalizeStandaloneText(element));
      continue;
    }

    if (element.label && element.label.text && element.id) {
      const boundText = labelToBoundText(element);
      const { label, ...shape } = element;
      const boundElements = Array.isArray(shape.boundElements) ? [...shape.boundElements] : [];
      if (!boundElements.some((b: AnyElement) => b?.id === boundText.id)) {
        boundElements.push({ type: 'text', id: boundText.id });
      }
      result.push({ ...shape, boundElements });
      result.push(boundText);
      continue;
    }

    result.push(element);
  }

  return result;
}
