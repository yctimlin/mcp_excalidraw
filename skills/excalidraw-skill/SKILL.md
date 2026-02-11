---
name: excalidraw-skill
description: Programmatic canvas toolkit for creating, editing, and refining Excalidraw diagrams via MCP tools with real-time canvas sync. Use when an agent needs to (1) draw or lay out diagrams on a live canvas, (2) iteratively refine diagrams using describe_scene and get_canvas_screenshot to see its own work, (3) export/import .excalidraw files or PNG/SVG images, (4) save/restore canvas snapshots, (5) convert Mermaid to Excalidraw, or (6) perform element-level CRUD, alignment, distribution, grouping, duplication, and locking. Requires a running canvas server (EXPRESS_SERVER_URL, default http://localhost:3000).
---

# Excalidraw Skill

## Quick Start

1. Ensure canvas server is reachable at `EXPRESS_SERVER_URL` (default `http://localhost:3000`).
2. Open the canvas URL in a browser (required for image export/screenshot).
3. Use MCP tools for all diagram operations; use `scripts/*.cjs` for CLI workflows.
4. For full tool/endpoint reference, read `references/cheatsheet.md`.

## Workflow: Draw A Diagram

1. Confirm canvas: `node scripts/healthcheck.cjs` or `GET /health`.
2. Optional: `clear_canvas` to start fresh.
3. Create shapes first (`create_element` with type rectangle/diamond/ellipse). Set `text` field to label shapes.
4. Create arrows/lines after endpoints exist.
5. `align_elements` / `distribute_elements` after rough placement.
6. `describe_scene` to verify layout. `get_canvas_screenshot` to visually check.

## Workflow: Iterative Refinement (Key Differentiator)

The feedback loop that makes this skill unique:

1. `describe_scene` -- read what's on the canvas (types, positions, labels, connections).
2. Decide what to change based on the description.
3. Apply changes (`update_element`, `align_elements`, `create_element`, etc.).
4. `get_canvas_screenshot` -- visually verify the result (returns PNG to multimodal AI).
5. Repeat until satisfied.

Example flow:
```
create_element (rectangles, arrows) → describe_scene → "layout is cramped"
→ distribute_elements → get_canvas_screenshot → "arrow misaligned"
→ update_element → get_canvas_screenshot → "looks good"
→ export_scene --filePath architecture.excalidraw
```

## Workflow: Refine An Existing Diagram

1. `describe_scene` to understand current state.
2. Identify targets by id, type, or label text (not x/y coordinates).
3. `update_element` to move/resize/recolor, `delete_element` to remove.
4. `get_canvas_screenshot` to verify changes visually.
5. If updates fail: check element id exists (`get_element`), element isn't locked (`unlock_elements`).

## Workflow: File I/O (Diagrams-as-Code)

- Export to .excalidraw format: `export_scene` with optional `filePath`.
- Import from .excalidraw: `import_scene` with `mode: "replace"` or `"merge"`.
- Export to image: `export_to_image` with `format: "png"` or `"svg"` (requires browser open).
- CLI export: `node scripts/export-elements.cjs --out diagram.elements.json`
- CLI import: `node scripts/import-elements.cjs --in diagram.elements.json --mode batch|sync`

## Workflow: Snapshots (Save/Restore Canvas State)

1. `snapshot_scene` with a name before risky changes.
2. Make changes, `describe_scene` / `get_canvas_screenshot` to evaluate.
3. `restore_snapshot` to rollback if needed.

## Workflow: Duplication

- `duplicate_elements` with `elementIds` and optional `offsetX`/`offsetY` (default 20,20).
- Useful for creating repeated patterns or copying existing layouts.

## Points Format for Arrows/Lines

The `points` field accepts both formats:
- Tuple: `[[0, 0], [100, 50]]`
- Object: `[{"x": 0, "y": 0}, {"x": 100, "y": 50}]`

Both are normalized to tuples automatically.

## References

- `references/cheatsheet.md`: Complete MCP tool list (23 tools) + REST API endpoints + payload shapes.
