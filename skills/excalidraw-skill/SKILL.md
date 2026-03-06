---
name: excalidraw-skill
description: Programmatic canvas toolkit for creating, editing, and refining Excalidraw diagrams via MCP tools with real-time canvas sync. Use when an agent needs to (1) draw or lay out diagrams on a live canvas, (2) iteratively refine diagrams using describe_scene and get_canvas_screenshot to see its own work, (3) export/import .excalidraw files or PNG/SVG images, (4) save/restore canvas snapshots, (5) convert Mermaid to Excalidraw, or (6) perform element-level CRUD, alignment, distribution, grouping, duplication, and locking. Requires a running canvas server (EXPRESS_SERVER_URL, default http://localhost:3000).
---

# Excalidraw Skill

## Step 0: Determine Connection Mode

Two modes are available. Try MCP first — it has more capabilities.

**MCP mode** (preferred): If `excalidraw/batch_create_elements` and other `excalidraw/*` tools appear in your tool list, use them directly. MCP tools handle label and arrow binding format automatically.

**REST API mode** (fallback): If MCP tools aren't available, use HTTP endpoints at `http://localhost:3000`. See the cheatsheet for REST payloads. Note the format differences in the table below — REST and MCP accept slightly different field names.

**Neither works?** Tell the user:
> The Excalidraw canvas server is not running. To set up:
> 1. `git clone https://github.com/yctimlin/mcp_excalidraw && cd mcp_excalidraw`
> 2. `npm ci && npm run build`
> 3. `PORT=3000 npm run canvas`
> 4. Open `http://localhost:3000` in a browser
> 5. (Recommended) Install the MCP server:
>    `claude mcp add excalidraw -s user -e EXPRESS_SERVER_URL=http://localhost:3000 -- node /path/to/mcp_excalidraw/dist/index.js`

### MCP vs REST API Quick Reference

| Operation | MCP Tool | REST API Equivalent |
|-----------|----------|-------------------|
| Create elements | `batch_create_elements` | `POST /api/elements/batch` |
| Get all elements | `query_elements` | `GET /api/elements` |
| Get one element | `get_element` | `GET /api/elements/:id` |
| Update element | `update_element` | `PUT /api/elements/:id` |
| Delete element | `delete_element` | `DELETE /api/elements/:id` |
| Clear canvas | `clear_canvas` | `DELETE /api/elements/clear` |
| Describe scene | `describe_scene` | `GET /api/elements` (parse manually) |
| Export scene | `export_scene` | `GET /api/elements` (save to file) |
| Import scene | `import_scene` | `POST /api/elements/sync` |
| Snapshot | `snapshot_scene` | `POST /api/snapshots` |
| Restore snapshot | `restore_snapshot` | `GET /api/snapshots/:name` then `POST /api/elements/sync` |
| Screenshot | `get_canvas_screenshot` | `POST /api/export/image` (needs browser) |
| Viewport | `set_viewport` | `POST /api/viewport` (needs browser) |
| Export image | `export_to_image` | `POST /api/export/image` (needs browser) |
| Export URL | `export_to_excalidraw_url` | Only via MCP |

### Format Differences Between Modes (Critical)

1. **Labels**: MCP accepts `"text": "My Label"` on shapes (auto-converts). REST requires `"label": {"text": "My Label"}`.
2. **Arrow binding**: MCP accepts `startElementId`/`endElementId`. REST requires `"start": {"id": "..."}` / `"end": {"id": "..."}`.
3. **fontFamily**: Must be a string (e.g. `"1"`) or omit entirely. Never pass a number.
4. **Updating labels via REST**: Re-include `"label"` in the PUT body to ensure it renders correctly after updates.

---

## Coordinate System

The canvas uses a 2D coordinate grid: **(0, 0) is the origin**, **x increases rightward**, **y increases downward**. Plan your layout before writing any JSON.

**General spacing guidelines:**
- Vertical spacing between tiers: 80–120px (enough that arrows don't crowd labels)
- Horizontal spacing between siblings: 40–60px minimum
- Shape width: `max(160, labelCharCount * 9)` to prevent text truncation
- Shape height: 60px single-line, 80px two-line labels
- Background/zone padding: 50px on all sides around contained elements

---

## Layout Anti-Patterns (Critical for Complex Diagrams)

These are the most common mistakes that produce unreadable diagrams. Avoid all of them.

### 1. Do NOT use `label.text` (or `text`) on large background zone rectangles

When you put a label on a background rectangle, Excalidraw creates a bound text element centered in the middle of that shape — right where your service boxes will be placed. The text overlaps everything inside the zone and cannot be repositioned.

**Wrong:**
```json
{"id": "vpc-zone", "type": "rectangle", "x": 50, "y": 50, "width": 800, "height": 400, "text": "VPC (10.0.0.0/16)"}
```

**Right — use a free-standing text element anchored at the top of the zone:**
```json
{"id": "vpc-zone", "type": "rectangle", "x": 50, "y": 50, "width": 800, "height": 400, "backgroundColor": "#e3f2fd"},
{"id": "vpc-label", "type": "text", "x": 70, "y": 60, "width": 300, "height": 30, "text": "VPC (10.0.0.0/16)", "fontSize": 18, "fontWeight": "bold"}
```

The free-standing text element sits at the top corner of the zone and doesn't interfere with elements placed inside.

### 2. Avoid cross-zone arrows in complex diagrams

An arrow from an element in one layout zone to an element in a distant zone will draw a long diagonal line crossing through everything in between. In a multi-zone infra diagram this produces an unreadable tangle of spaghetti.

**Design rule:** Keep arrows within the same zone or tier. To show cross-zone relationships, use annotation text or separate the zones so their edges are adjacent (no elements between them), and route the arrow along the edge.

If you must connect across zones, use an elbowed arrow that travels along the perimeter — never through the middle of another zone.

### 3. Use arrow labels sparingly

Arrow labels are placed at the midpoint of the arrow. On short arrows, they overlap the shapes at both ends. On crowded diagrams, they collide with nearby elements.

- Only add an arrow label when the relationship name is genuinely essential (e.g., protocol, port number, data direction).
- If you're adding a label to every arrow, reconsider — it usually adds visual noise, not clarity.
- Keep arrow labels to ≤ 12 characters. Prefer omitting them entirely on dense diagrams.

---

## Quality: Why It Matters (and How to Check)

Excalidraw diagrams are visual communication. If text is cut off, elements overlap, or arrows cross through unrelated shapes, the diagram becomes confusing and unprofessional — it defeats the whole purpose of drawing it. So after every batch of elements, verify before adding more.

### Quality Checklist

After each `batch_create_elements` / `POST /api/elements/batch`, take a screenshot and check:

1. **Text truncation** — Is all label text fully visible? Truncated text means the shape is too small. Increase `width` and/or `height`.
2. **Overlap** — Do any shapes share the same space? Background zones must fully contain children with padding.
3. **Arrow crossing** — Do arrows cut through unrelated elements? If yes, route them around using curved or elbowed arrows (see Arrow Routing below).
4. **Arrow-label overlap** — Arrow labels sit at the midpoint. If they overlap a shape, shorten the label or adjust the arrow path.
5. **Spacing** — At least 40px gap between elements. Cramped layouts are hard to read.
6. **Readability** — Font size ≥ 16 for body text, ≥ 20 for titles.
7. **Zone label placement** — If you used `text`/`label.text` on a background zone rectangle, the zone label will be centered in the middle of the zone, overlapping everything inside. Fix: delete the bound text element and add a free-standing text element at the top of the zone instead (see Layout Anti-Patterns above).

If you find any issue: **stop, fix it, re-screenshot, then continue.** Say "I see [issue], fixing it" rather than glossing over problems. Only proceed once all checks pass.

---

## Workflow: Drawing a New Diagram

### Mermaid vs. Direct Creation — Which to Use?

**Use `create_from_mermaid`** when: the user already has a Mermaid diagram, or the structure maps cleanly to a flowchart/sequence/ER diagram with standard Mermaid syntax. It's fast and handles conversion automatically, though you get less control over exact layout.

**Use `batch_create_elements` directly** when: you need precise layout control, the diagram type doesn't map to Mermaid well (e.g., custom architecture, annotated cloud diagrams), or you want elements positioned in a specific coordinate grid.

### MCP Mode

1. Call `read_diagram_guide` for design best practices (colors, fonts, anti-patterns).
2. Plan your coordinate grid on paper/in comments — map out tiers and x-positions before writing JSON.
3. Optional: `clear_canvas` to start fresh.
4. Use `batch_create_elements` — create shapes and arrows in one call. Custom `id` fields (e.g. `"id": "auth-svc"`) make later updates easy.
5. Set shape widths using `max(160, labelLength * 9)`. Use `text` field for labels.
6. Bind arrows with `startElementId` / `endElementId` — they auto-route to element edges.
7. `set_viewport` with `scrollToContent: true` to auto-fit.
8. `get_canvas_screenshot` → run Quality Checklist → fix issues before next iteration.

**MCP element + arrow example:**
```json
{"elements": [
  {"id": "lb", "type": "rectangle", "x": 300, "y": 50, "width": 180, "height": 60, "text": "Load Balancer"},
  {"id": "svc-a", "type": "rectangle", "x": 100, "y": 200, "width": 160, "height": 60, "text": "Web Server 1"},
  {"id": "svc-b", "type": "rectangle", "x": 450, "y": 200, "width": 160, "height": 60, "text": "Web Server 2"},
  {"id": "db", "type": "rectangle", "x": 275, "y": 350, "width": 210, "height": 60, "text": "PostgreSQL"},
  {"type": "arrow", "x": 0, "y": 0, "startElementId": "lb", "endElementId": "svc-a"},
  {"type": "arrow", "x": 0, "y": 0, "startElementId": "lb", "endElementId": "svc-b"},
  {"type": "arrow", "x": 0, "y": 0, "startElementId": "svc-a", "endElementId": "db"},
  {"type": "arrow", "x": 0, "y": 0, "startElementId": "svc-b", "endElementId": "db"}
]}
```

### REST API Mode

1. Plan your coordinate grid first.
2. Optional: `curl -X DELETE http://localhost:3000/api/elements/clear`
3. Create elements using `POST /api/elements/batch`. Use `"label": {"text": "..."}` for labels.
4. Bind arrows with `"start": {"id": "..."}` / `"end": {"id": "..."}`.
5. Verify with `POST /api/export/image` → save PNG → run Quality Checklist.

**REST API element + arrow example:**
```bash
curl -X POST http://localhost:3000/api/elements/batch \
  -H "Content-Type: application/json" \
  -d '{
    "elements": [
      {"id": "svc-a", "type": "rectangle", "x": 100, "y": 100, "width": 160, "height": 60, "label": {"text": "Service A"}},
      {"id": "svc-b", "type": "rectangle", "x": 400, "y": 100, "width": 160, "height": 60, "label": {"text": "Service B"}},
      {"type": "arrow", "x": 0, "y": 0, "start": {"id": "svc-a"}, "end": {"id": "svc-b"}, "label": {"text": "calls"}}
    ]
  }'
```

---

## Arrow Routing — Avoid Overlaps

Straight arrows can cross through elements in complex diagrams. Use curved or elbowed arrows when needed:

**Curved arrows** (smooth arc over obstacles):
```json
{
  "type": "arrow", "x": 100, "y": 100,
  "points": [[0, 0], [50, -40], [200, 0]],
  "roundness": {"type": 2}
}
```
The intermediate waypoint `[50, -40]` lifts the arrow upward. `roundness: {type: 2}` makes it smooth.

**Elbowed arrows** (right-angle / L-shaped routing):
```json
{
  "type": "arrow", "x": 100, "y": 100,
  "points": [[0, 0], [0, -50], [200, -50], [200, 0]],
  "elbowed": true
}
```

**When to use which:**
- Fan-out (one source → many targets): curved arrows with waypoints spread to avoid overlapping
- Cross-lane (connecting to side panels): elbowed arrows that go up, then across, then down
- Long horizontal connections: curved arrows with a slight vertical offset

**Rule:** If an arrow would pass through an unrelated shape, add a waypoint to route around it.

**Points format**: Both `[[x, y], ...]` tuples and `[{"x": ..., "y": ...}]` objects are accepted; both are normalized automatically.

---

## Workflow: Iterative Refinement

Using `describe_scene` and `get_canvas_screenshot` together is what makes this skill powerful.

- **`describe_scene`** → returns structured text: element IDs, types, positions, labels, connections. Use this when you need to know *what's on the canvas* before making programmatic updates (find IDs, understand bounding boxes).
- **`get_canvas_screenshot`** → returns a PNG image of the actual rendered canvas. Use this for *visual quality verification* — it shows you exactly what the user sees, including truncation, overlap, and arrow routing.

**Feedback loop (MCP):**
```
batch_create_elements
  → get_canvas_screenshot → "text truncated on auth-svc"
  → update_element (increase width) → get_canvas_screenshot → "overlap between auth-svc and rate-limiter"
  → update_element (reposition) → get_canvas_screenshot → "all checks pass"
  → proceed
```

**Feedback loop (REST):**
```
POST /api/elements/batch
  → POST /api/export/image → save PNG → evaluate
  → PUT /api/elements/:id (fix issues) → re-screenshot → evaluate
  → proceed
```

---

## Workflow: Refine an Existing Diagram

1. `describe_scene` to understand current state — note element IDs and positions.
2. Identify elements by `id` or label text (not by x/y coordinates — they change).
3. `update_element` to resize/recolor/move; `delete_element` to remove.
4. `get_canvas_screenshot` to confirm the change looks right.
5. If updates fail: check the ID exists with `get_element`; check it's not locked with `unlock_elements`.

---

## Workflow: Mermaid Conversion

For converting existing Mermaid diagrams to Excalidraw:

**MCP mode:**
```
create_from_mermaid(mermaidDiagram: "graph TD\n  A --> B\n  B --> C")
```
After conversion, call `set_viewport` with `scrollToContent: true` and `get_canvas_screenshot` to verify layout. If the auto-layout is poor (nodes crowded, edges crossing), identify problem elements with `describe_scene` and reposition with `update_element`.

**REST mode:**
```bash
curl -X POST http://localhost:3000/api/elements/from-mermaid \
  -H "Content-Type: application/json" \
  -d '{"mermaid": "graph TD\n  A --> B\n  B --> C"}'
```

---

## Workflow: File I/O

- Export to `.excalidraw`: `export_scene` with optional `filePath`
- Import from `.excalidraw`: `import_scene` with `mode: "replace"` or `"merge"`
- Export to image: `export_to_image` with `format: "png"` or `"svg"` (requires browser open)
- Share link: `export_to_excalidraw_url` — encrypts scene, returns shareable excalidraw.com URL
- CLI export: `node scripts/export-elements.cjs --out diagram.elements.json`
- CLI import: `node scripts/import-elements.cjs --in diagram.elements.json --mode batch|sync`

## Workflow: Snapshots

1. `snapshot_scene` with a name before risky changes.
2. Make changes, evaluate with `describe_scene` / `get_canvas_screenshot`.
3. `restore_snapshot` to roll back if needed.

## Workflow: Duplication

`duplicate_elements` with `elementIds` and optional `offsetX`/`offsetY` (default: 20, 20). Useful for repeated patterns or copying layouts.

## Error Recovery

- **Elements not appearing?** Check `describe_scene` — they may have been created off-screen. Use `set_viewport` with `scrollToContent: true`.
- **Arrow not connecting?** Verify element IDs with `get_element`. Make sure `startElementId`/`endElementId` (MCP) or `start.id`/`end.id` (REST) match existing element IDs.
- **Canvas in a bad state?** `snapshot_scene` first, then `clear_canvas` and rebuild. Or `restore_snapshot` to go back.
- **Element won't update?** It may be locked — call `unlock_elements` first.
- **Layout looking wrong after import?** Use `describe_scene` to inspect actual positions, then batch-update positions.
- **Duplicate text elements / element count doubling?** The frontend has an auto-sync timer that periodically sends the full Excalidraw scene back to the server (overwriting). Excalidraw internally generates a bound text element for every shape that has `label.text`. If you clear and re-send elements, Excalidraw may re-inject its cached bound texts, causing duplicates. To clean up: (1) use `query_elements` / `GET /api/elements` to find elements of `type: "text"` with a `containerId`; (2) delete the unwanted ones with `delete_element`; (3) wait a few seconds for auto-sync to settle before exporting. The safest approach is to **never put labels on background zone rectangles** — use free-standing text elements instead.

---

## References

- `references/cheatsheet.md`: Complete MCP tool list (26 tools) + REST API endpoints + payload shapes.
