// Stands in for `mermaid` and for the editor's own (v2) copy of
// @excalidraw/mermaid-to-excalidraw inside the Node exporter bundle. Only the
// editor's text-to-diagram dialog reaches them, and the exporter never opens
// it; leaving the real packages in adds ~7 MB of parser, cytoscape and katex
// code. The server's own Mermaid conversion uses the top-level v3 package.
export const parseMermaidToExcalidraw = async () => {
  throw new Error('The editor Mermaid dialog is not available in the headless renderer.');
};
export default {};
