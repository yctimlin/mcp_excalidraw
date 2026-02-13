---
name: excalidraw-skill
description: Programmatic canvas toolkit for creating, editing, and refining Excalidraw diagrams via MCP tools with real-time canvas sync. Use when an agent needs to (1) draw or lay out diagrams on a live canvas, (2) iteratively refine diagrams using describe_scene and get_canvas_screenshot to see its own work, (3) export/import .excalidraw files or PNG/SVG images, (4) save/restore canvas snapshots, (5) convert Mermaid to Excalidraw, or (6) perform element-level CRUD, alignment, distribution, grouping, duplication, and locking. Requires a running canvas server (EXPRESS_SERVER_URL, default http://localhost:3000).
---

# Excalidraw Skill

## Step 0: Detect Connection Mode

Before doing anything, determine which mode is available. Run these checks **in order**:

### Check 1: MCP Server (Best experience)
```bash
mcp-cli tools | grep excalidraw
```
If you see tools like `excalidraw/batch_create_elements` → **use MCP mode**. Call MCP tools directly.

### Check 2: REST API (Fallback — works without MCP server)
```bash
curl -s http://localhost:3000/health
```
If you get `{"status":"ok"}` → **use REST API mode**. Use HTTP endpoints (`curl` / `fetch`) from the cheatsheet.

### Check 3: Nothing works → Guide user to install
If neither works, tell the user:
> The Excalidraw canvas server is not running. To set up:
> 1. Clone: `git clone https://github.com/yctimlin/mcp_excalidraw && cd mcp_excalidraw`
> 2. Build: `npm ci && npm run build`
> 3. Start canvas: `HOST=0.0.0.0 PORT=3000 npm run canvas`
> 4. Open `http://localhost:3000` in a browser
> 5. (Recommended) Install the MCP server for the best experience:
>    ```
>    claude mcp add excalidraw -s user -e EXPRESS_SERVER_URL=http://localhost:3000 -- node /path/to/mcp_excalidraw/dist/index.js
>    ```

### MCP vs REST API Quick Reference

| Operation | MCP Tool | REST API Equivalent |
|-----------|----------|-------------------|
| Create elements | `batch_create_elements` | `POST /api/elements/batch` with `{"elements": [...]}` |
| Get all elements | `query_elements` | `GET /api/elements` |
| Get one element | `get_element` | `GET /api/elements/:id` |
| Update element | `update_element` | `PUT /api/elements/:id` |
| Delete element | `delete_element` | `DELETE /api/elements/:id` |
| Clear canvas | `clear_canvas` | `DELETE /api/elements/clear` |
| Describe scene | `describe_scene` | `GET /api/elements` (parse manually) |
| Export scene | `export_scene` | `GET /api/elements` (save to file) |
| Import scene | `import_scene` | `POST /api/elements/sync` with `{"elements": [...]}` |
| Snapshot | `snapshot_scene` | `POST /api/snapshots` with `{"name": "..."}` |
| Restore snapshot | `restore_snapshot` | `GET /api/snapshots/:name` then `POST /api/elements/sync` |
| Screenshot | `get_canvas_screenshot` | Only via MCP (needs browser) |
| Design guide | `read_diagram_guide` | Not available — see cheatsheet for guidelines |
| Viewport | `set_viewport` | `POST /api/viewport` (needs browser) |
| Export image | `export_to_image` | `POST /api/export/image` (needs browser) |
| Export URL | `export_to_excalidraw_url` | Only via MCP |

### REST API Gotchas (Critical — read before using REST API)

1. **Labels**: Use `"label": {"text": "My Label"}` (not `"text": "My Label"`). MCP tools auto-convert, REST API does not.
2. **Arrow binding**: Use `"start": {"id": "svc-a"}, "end": {"id": "svc-b"}` (not `"startElementId"`/`"endElementId"`). MCP tools accept `startElementId` and convert, REST API requires the `start`/`end` object format directly.
3. **fontFamily**: Must be a string (e.g. `"1"`) or omit it entirely. Do NOT pass a number like `1`.
4. **Updating labels**: When updating a shape via `PUT /api/elements/:id`, include the full `label` in the update body to preserve it. Omitting `label` from the update won't delete it, but re-sending ensures it renders correctly.
5. **Screenshot in REST mode**: `POST /api/export/image` returns `{"data": "<base64>"}`. Save to file and read it back for visual verification. Requires browser open.

## Quality Gate (MANDATORY — read before creating any diagram)

**After EVERY iteration (each batch of elements added), you MUST run a quality check before proceeding. NEVER say "looks great" unless ALL checks pass.**

### Quality Checklist — verify ALL before adding more elements:
1. **Text truncation**: Is ALL text fully visible? Labels must fit inside their shapes. If text is cut off or wrapping badly → increase `width` and/or `height`.
2. **Overlap**: Do ANY elements overlap each other? Check that no rectangles, ellipses, or text elements share the same space. Background zones must fully contain their children with padding.
3. **Arrow crossing**: Do arrows cross through unrelated elements or overlap with text labels? If yes → **use curved/elbowed arrows with waypoints** to route around obstacles (see "Arrow Routing" section). Never accept crossing arrows.
4. **Arrow-text overlap**: Do any arrow labels ("charge", "event", etc.) overlap with shapes? Arrow labels are positioned at the midpoint — if they overlap, either remove the label, shorten it, or adjust the arrow path.
5. **Spacing**: Is there at least 40px gap between elements? Cramped layouts are unreadable.
6. **Readability**: Can all labels be read at normal zoom? Font size >= 16 for body text, >= 20 for titles.

### If ANY issue is found:
- **STOP adding new elements**
- Fix the issue first (resize, reposition, delete and recreate)
- Re-verify with a new screenshot
- Only proceed to next iteration after ALL checks pass

### Sizing Rules (prevent truncation):
- **Shape width**: `max(160, labelTextLength * 9)` pixels. For multi-word labels like "API Gateway (Kong)", count all characters.
- **Shape height**: 60px for single line, 80px for 2 lines, 100px for 3 lines.
- **Background zones**: Add 50px padding on ALL sides around contained elements.
- **Element spacing**: 60px vertical between tiers, 40px horizontal between siblings.
- **Side panels**: Place at least 80px away from main diagram elements.
- **Arrow labels**: Keep labels short (1-2 words). Long arrow labels overlap with other elements.

### Layout Planning (prevent overlap):
Before creating elements, **plan your coordinate grid** on paper first:
- Tier 1 (y=50-130): Client apps
- Tier 2 (y=200-280): Gateway/Edge
- Tier 3 (y=350-440): Services (spread wide: each service ~180px apart)
- Tier 4 (y=510-590): Data stores
- Side panels: x < 0 (left) or x > mainDiagramRight + 80 (right)

**Do NOT place side panels (observability, external APIs) at the same x-range as the main diagram — they WILL overlap.**

## Quick Start

1. Run **Step 0** above to detect your connection mode.
2. Open the canvas URL in a browser (required for image export/screenshot).
3. **MCP mode**: Use MCP tools for all operations. **REST mode**: Use HTTP endpoints from cheatsheet.
4. For full tool/endpoint reference, read `references/cheatsheet.md`.

## Workflow: Draw A Diagram

### MCP Mode
1. **Call `read_diagram_guide`** first to load design best practices.
2. **Plan your coordinate grid** (see Quality Gate → Layout Planning) before writing any JSON.
3. Optional: `clear_canvas` to start fresh.
4. Use `batch_create_elements` with shapes AND arrows in one call.
5. **Assign custom `id` to shapes** (e.g. `"id": "auth-svc"`). Set `text` field to label shapes.
6. **Size shapes for their text** — use `width: max(160, textLength * 9)`.
7. **Bind arrows** using `startElementId` / `endElementId` — arrows auto-route.
8. `set_viewport` with `scrollToContent: true` to auto-fit the diagram.
9. **Run Quality Checklist** — `get_canvas_screenshot` and critically evaluate. Fix issues before proceeding.

### REST API Mode
1. Read `references/cheatsheet.md` for design guidelines.
2. **Plan your coordinate grid** (see Quality Gate → Layout Planning) before writing any JSON.
3. Optional: `curl -X DELETE http://localhost:3000/api/elements/clear`
4. Create elements in one call (use `@file.json` for large payloads):
   ```bash
   curl -X POST http://localhost:3000/api/elements/batch \
     -H "Content-Type: application/json" \
     -d '{"elements": [
       {"id": "svc-a", "type": "rectangle", "x": 0, "y": 0, "width": 160, "height": 60, "label": {"text": "Service A"}},
       {"id": "svc-b", "type": "rectangle", "x": 0, "y": 200, "width": 160, "height": 60, "label": {"text": "Service B"}},
       {"type": "arrow", "x": 0, "y": 0, "start": {"id": "svc-a"}, "end": {"id": "svc-b"}}
     ]}'
   ```
5. **Use `"label": {"text": "..."}` for shape labels** (not `"text": "..."`).
6. **Bind arrows with `"start": {"id": "..."}` / `"end": {"id": "..."}`** — server auto-routes edges.
7. **Size shapes for their text** — use `width: max(160, labelTextLength * 9)`.
8. **Run Quality Checklist** — take screenshot, critically evaluate. Fix issues before adding more elements.

### Arrow Binding (Recommended)

Bind arrows to shapes for auto-routed edges. The format differs between MCP and REST API:

**MCP Mode** — use `startElementId` / `endElementId`:
```json
{"elements": [
  {"id": "svc-a", "type": "rectangle", "x": 0, "y": 0, "width": 120, "height": 60, "text": "Service A"},
  {"id": "svc-b", "type": "rectangle", "x": 0, "y": 200, "width": 120, "height": 60, "text": "Service B"},
  {"type": "arrow", "x": 0, "y": 0, "startElementId": "svc-a", "endElementId": "svc-b", "text": "calls"}
]}
```

**REST API Mode** — use `start: {id}` / `end: {id}` and `label: {text}`:
```json
{"elements": [
  {"id": "svc-a", "type": "rectangle", "x": 0, "y": 0, "width": 120, "height": 60, "label": {"text": "Service A"}},
  {"id": "svc-b", "type": "rectangle", "x": 0, "y": 200, "width": 120, "height": 60, "label": {"text": "Service B"}},
  {"type": "arrow", "x": 0, "y": 0, "start": {"id": "svc-a"}, "end": {"id": "svc-b"}, "label": {"text": "calls"}}
]}
```

Arrows without binding use manual `x`, `y`, `points` coordinates.

### Arrow Routing — Avoid Overlaps (Critical for complex diagrams)

Straight arrows (2-point) cause crossing and overlap in complex diagrams. **Use curved or elbowed arrows instead:**

**Option 1: Curved arrows** — add intermediate waypoints + `roundness`:
```json
{
  "type": "arrow", "x": 100, "y": 100,
  "points": [[0, 0], [50, -40], [200, 0]],
  "roundness": {"type": 2},
  "strokeColor": "#1971c2"
}
```
The waypoint `[50, -40]` pushes the arrow upward to arc over elements. `roundness: {type: 2}` makes it a smooth curve.

**Option 2: Elbowed arrows** — right-angle routing (L-shaped or Z-shaped):
```json
{
  "type": "arrow", "x": 100, "y": 100,
  "points": [[0, 0], [0, -50], [200, -50], [200, 0]],
  "elbowed": true,
  "strokeColor": "#1971c2"
}
```

**When to use which:**
- **Fan-out arrows** (one source → many targets): Use curved arrows with waypoints spread vertically to avoid overlapping each other.
- **Cross-lane arrows** (connecting to side panels): Use elbowed arrows that route around the main diagram — go UP first, then ACROSS, then DOWN.
- **Inter-service arrows** (horizontal connections): Use curved arrows with a slight vertical offset to avoid crossing through adjacent elements.

**Rule of thumb:** If an arrow would cross through an unrelated element, add a waypoint to route around it. Never accept crossing arrows — always fix them.

## Workflow: Iterative Refinement (Key Differentiator)

The feedback loop that makes this skill unique. **Each iteration MUST include a quality check.**

### MCP Mode (full feedback loop)
1. Add elements (`batch_create_elements`, `create_element`).
2. `set_viewport` with `scrollToContent: true`.
3. `get_canvas_screenshot` — **critically evaluate** against the Quality Checklist.
4. **If issues found** → fix them (`update_element`, `delete_element`, resize, reposition).
5. `get_canvas_screenshot` again — re-verify fix.
6. **Only proceed to next iteration when ALL quality checks pass.**

### REST API Mode (partial feedback loop)
1. Add elements via `POST /api/elements/batch`.
2. `POST /api/viewport` with `{"scrollToContent": true}`.
3. Take screenshot: `POST /api/export/image` → save PNG → **critically evaluate** against Quality Checklist.
4. **If issues found** → fix via `PUT /api/elements/:id` or delete and recreate.
5. Re-screenshot and re-verify.
6. **Only proceed to next iteration when ALL quality checks pass.**

### How to critically evaluate a screenshot:
- Look at EVERY label — is any text cut off or overflowing its container?
- Look at EVERY arrow — does any arrow pass through an unrelated element?
- Look at ALL element pairs — do any overlap or touch?
- Look at spacing — is anything crammed together?
- **Be honest.** If you see ANY issue, say "I see [issue], fixing it" — not "looks great".

Example flow (MCP):
```
batch_create_elements → get_canvas_screenshot → "text truncated on 2 shapes"
→ update_element (increase widths) → get_canvas_screenshot → "overlap between X and Y"
→ update_element (reposition) → get_canvas_screenshot → "all checks pass"
→ proceed to next iteration
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

## Workflow: Share Diagram (excalidraw.com URL)

1. Create your diagram using any of the above workflows.
2. `export_to_excalidraw_url` — uploads encrypted scene, returns a shareable URL.
3. Share the URL — anyone can open it in excalidraw.com to view and edit.

## Workflow: Viewport Control

- `set_viewport` with `scrollToContent: true` — auto-fit all elements (zoom-to-fit).
- `set_viewport` with `scrollToElementId: "my-element"` — center view on a specific element.
- `set_viewport` with `zoom: 1.5, offsetX: 100, offsetY: 200` — manual camera control.

## References

- `references/cheatsheet.md`: Complete MCP tool list (26 tools) + REST API endpoints + payload shapes.
