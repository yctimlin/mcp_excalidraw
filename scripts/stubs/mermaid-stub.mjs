// Stands in for @excalidraw/mermaid-to-excalidraw and mermaid inside the Node
// exporter bundle. The exporter never converts Mermaid (that stays in the
// browser tab), and leaving the real packages in adds ~7 MB of parser,
// cytoscape and katex code to a bundle that only draws SVG.
export const parseMermaidToExcalidraw = async () => {
  throw new Error('Mermaid conversion is not available in the headless renderer; use the canvas tab.');
};
export default {};
