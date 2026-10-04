import { convertToExcalidrawElements, exportToCanvas, FONT_FAMILY } from '@excalidraw/excalidraw'

// Printable ASCII: what agents draw with almost always. Other scripts (CJK,
// emoji) load on demand, and the tab re-measures text when they arrive.
const LATIN = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('')

// Excalidraw sizes text and shorthand-labelled shapes when it converts them,
// using whatever font the browser has at that moment. Its fonts come from a
// CDN and register lazily, so a scene converted first is measured with a
// fallback font: text clips, and auto-sized boxes come out too small. The
// exporter loads the fonts its elements use through Excalidraw's own loader,
// so a tiny off-screen export of every family loads them up front.
let preload: Promise<void> | null = null

export const preloadCanvasFonts = (timeoutMs = 4000): Promise<void> => {
  preload ??= Promise.race([
    exportToCanvas({
      elements: convertToExcalidrawElements(Object.values(FONT_FAMILY).map((fontFamily, i) => ({
        type: 'text' as const, x: 0, y: i * 40, text: LATIN, fontFamily
      }))),
      appState: {},
      files: null,
    }).then(() => undefined),
    // An unreachable CDN must not hold the scene back
    new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
  ]).catch(error => {
    console.warn('Could not preload canvas fonts:', error)
  })
  return preload
}
