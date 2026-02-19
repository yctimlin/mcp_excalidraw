---
name: excalidraw-skill
description: Programmatic canvas toolkit for creating, editing, and refining Excalidraw diagrams via MCP tools (32 tools) or REST API with real-time canvas sync, multi-tenant workspace isolation, SQLite persistence, project management, full-text search, and element version history. Use when an agent needs to draw or lay out diagrams on a live canvas, iteratively refine diagrams using screenshots, manage workspaces/tenants and projects, export/import .excalidraw files or PNG/SVG images, search elements, view change history, save/restore canvas snapshots, or perform element-level CRUD. Canvas server port is configurable via CANVAS_PORT env var (default 3000).
---

# Excalidraw Skill

## Step 0: Detect Connection Mode

Run these checks **in order**:

1. **MCP Server** (best): If tools like `batch_create_elements` are available → use MCP mode.
2. **REST API** (fallback): `curl -s http://localhost:3000/health` returns `{"status":"ok"}` → use REST API mode.
3. **Nothing works**: Guide user to install (clone `sanjibdevnathlabs/mcp-excalidraw-local`, build, configure MCP).

See `references/cheatsheet.md` for the full MCP-vs-REST mapping and REST API gotchas.

## Core Principles (Read Before Any Diagram)

These principles were learned through extensive iterative use. Violating them produces bad diagrams.

### 1. Never Trust Blind Output — Use the Write-Check-Review Cycle

Every diagram iteration follows this mandatory loop:

```
WRITE (create/update elements)
  → CHECK (screenshot to see actual rendering)
    → REVIEW (critically evaluate against Quality Checklist)
      → FIX (if issues found, fix and re-screenshot)
        → only proceed when ALL checks pass
```

**Screenshot strategy**: `get_canvas_screenshot` may return empty images. When it fails, use Chrome DevTools MCP (`take_screenshot` after `navigate_page` to canvas URL) as a reliable fallback.

### 2. Use batch_create_elements, Not Mermaid

The `create_from_mermaid` tool produces **low-quality output**: overlapping text, poor spacing, unreadable labels. It is a quick preview tool, not a production tool.

For quality diagrams, **always use `batch_create_elements`** with precise coordinates, explicit sizing, and color coding. The extra planning time pays for itself in fewer fix iterations.

### 3. Shapes First, Arrows Second — Two Separate Batches

Create shapes in one batch, then arrows in a separate batch. Arrow binding (`startElementId`/`endElementId`) requires shapes to already exist in the scene. Mixing both in one call can work but often produces binding errors.

### 4. Multiple Diagrams on One Canvas

**Never clear the canvas** between diagrams. Place them side-by-side or in a grid:

```
Diagram 1: x=0 to ~1100
Diagram 2: x=1400 onward  (300px gap)
— or —
Row 1: y=0 to ~800
Row 2: y=1100 onward  (300px gap)
```

Use a title text element above each diagram to label it.

### 5. Set roughness: 0 for Clean Diagrams

Excalidraw defaults to hand-drawn style (roughness > 0). For professional, readable diagrams, always set `"roughness": 0` on every element. Also use `"strokeWidth": 2` for arrows to ensure visibility.

## Sizing Rules (Critical — Prevents Truncation)

Excalidraw's Virgil font is ~30% wider than standard fonts. These rules account for that.

### Rectangles

```
width:  max(200, characterCount * 11)
height: 70 (1 line), 80 (2 lines), 100 (3 lines)
fontSize: 16-20
```

### Diamonds (Decision Nodes)

Diamond usable text area is ~50% of the bounding box. **Double your width estimate.**

```
width:  max(400, longestLineChars * 18)
height: max(160, lineCount * 50)
fontSize: 16
```

A diamond with text "Behavioral guideline\nor project standard?" (20 chars) needs at least 400x160.

### Ellipses

Ellipse text area is ~60% of bounding box. Size generously.

```
width:  max(280, characterCount * 14)
height: max(65, lineCount * 35)
fontSize: 16-18
```

### Text Elements (Standalone Titles)

```
fontSize: 24-28 for diagram titles
fontSize: 16-20 for annotations
```

## Arrow Visibility Rules (Critical — Prevents Invisible Arrows)

When arrows are bound to shapes via `startElementId`/`endElementId`, the actual rendered arrow length equals the **gap between shape edges minus binding padding (8px each side)**. If shapes are too close, arrows shrink to 0px and become invisible.

### Minimum Gap Between Connected Shapes

| Connection Direction | Minimum Gap | Recommended Gap |
|---------------------|-------------|-----------------|
| Vertical (top-down flow) | 80px | 120px |
| Horizontal (left-right) | 100px | 140px |

### Calculating Vertical Gap for Flowcharts

```
gap = nextShapeY - (currentShapeY + currentShapeHeight)

Example (diamonds h=160, gap needed ≥ 120):
  Q1: y=260, h=160 → bottom edge = 420
  Q2: y=540         → gap = 540 - 420 = 120px ✓
```

If the gap is < 80px, arrows will be too short to see — especially with labels like "YES"/"NO".

## Workflow: Draw A Diagram

### Phase 1: Plan

Before writing any JSON, plan on paper:

1. **List all elements**: shapes, labels, connections
2. **Choose layout direction**: top-down (flowcharts), left-right (timelines), grid (architecture)
3. **Assign coordinates**: use the sizing rules above to compute widths/heights, then lay out with proper gaps
4. **Assign IDs**: every shape needs a custom `id` so arrows can reference it

### Phase 2: Create Shapes (Batch 1)

```json
{"elements": [
  {"id": "title", "type": "text", "x": 100, "y": 0,
   "text": "MY DIAGRAM", "fontSize": 28, "strokeColor": "#1e1e1e"},
  {"id": "box-a", "type": "rectangle", "x": 0, "y": 80,
   "width": 200, "height": 70, "text": "Service A",
   "backgroundColor": "#a5d8ff", "strokeColor": "#1971c2",
   "roughness": 0, "fontSize": 18},
  {"id": "box-b", "type": "rectangle", "x": 0, "y": 280,
   "width": 200, "height": 70, "text": "Service B",
   "backgroundColor": "#b2f2bb", "strokeColor": "#2f9e44",
   "roughness": 0, "fontSize": 18}
]}
```

### Phase 3: Create Arrows (Batch 2)

```json
{"elements": [
  {"type": "arrow", "x": 100, "y": 150,
   "startElementId": "box-a", "endElementId": "box-b",
   "width": 0, "height": 130, "text": "calls",
   "strokeColor": "#1e1e1e", "roughness": 0, "strokeWidth": 2,
   "endArrowhead": "arrow"}
]}
```

### Phase 4: Check (MANDATORY)

1. `set_viewport` with `scrollToContent: true`
2. Wait 1-2 seconds for render
3. Take screenshot (MCP `get_canvas_screenshot` or Chrome DevTools `take_screenshot`)
4. **Critically evaluate** against the Quality Checklist below
5. Fix any issues, re-screenshot, repeat until clean

## Quality Checklist

After EVERY batch of elements, verify ALL of these:

| Check | What to Look For | Fix |
|-------|-----------------|-----|
| **Text truncation** | Any label cut off or hidden? | Increase shape width/height |
| **Invisible arrows** | Can you see arrows between all connected shapes? | Increase gap between shapes to ≥ 120px |
| **Arrow labels** | Do YES/NO/labels overlap with shapes? | Shorten labels or increase gap |
| **Overlap** | Do any elements share space? | Reposition with more spacing |
| **Readability** | Can all text be read at 50-70% zoom? | Increase fontSize to ≥ 16 |
| **Spacing** | At least 40px gap between unconnected elements? | Spread elements apart |

### If ANY Check Fails

**STOP.** Do not add more elements. Fix the issue first:

1. Use `update_element` to resize/reposition
2. Or `delete_element` + recreate with better coordinates
3. Re-screenshot to verify the fix
4. Only proceed when ALL checks pass

### How to Honestly Evaluate a Screenshot

- Zoom into different regions — don't just glance at the overview
- Check every label individually for truncation
- Trace every arrow path for visibility
- **If you see ANY issue, say "I see [issue], fixing it"** — never say "looks great" unless it truly is

## Color Palette

Use consistent colors from this palette:

| Role | Fill | Stroke | Use For |
|------|------|--------|---------|
| Primary | #a5d8ff | #1971c2 | Main flow, services |
| Success | #b2f2bb | #2f9e44 | Approved, healthy, YES paths |
| Warning | #ffd8a8 | #e8590c | Attention, agents |
| Error | #ffc9c9 | #e03131 | Critical, NO paths, failures |
| Purple | #eebefa | #9c36b5 | Rules, governance |
| Cyan | #99e9f2 | #0c8599 | Data stores, MCP |
| Neutral | #e9ecef | #868e96 | Secondary, annotations |
| Default | #ffffff | #1e1e1e | Decisions, generic |

## Flowchart Template (Tested & Verified)

This template produces clean, readable decision flowcharts:

```
Layout:
  Diamonds: w=400, h=160, fontSize=16, gap=120px vertical
  Answer boxes: w=300, h=80, fontSize=20, offset 130px right of diamonds
  Start ellipse: w=340, h=70, fontSize=18
  Title: fontSize=28
  Arrows: strokeWidth=2, roughness=0
  YES arrows: strokeColor=#2f9e44 (green), horizontal right
  NO arrows: strokeColor=#e03131 (red), vertical down
  All elements: roughness=0
```

## Architecture Diagram Template

```
Layout:
  Zones: large rectangles, backgroundColor=#e9ecef, opacity=30
  Services: w=200, h=70, fontSize=18, spaced 60px apart
  Data stores: w=180, h=60, fontSize=16, strokeColor=#0c8599
  Arrows: solid for sync, dashed (strokeStyle="dashed") for async
  Title: fontSize=24 above each zone
```

## Workflow: Iterative Refinement

```
create shapes (batch 1)
  → create arrows (batch 2)
    → set_viewport(scrollToContent: true)
      → wait 1-2s
        → screenshot
          → evaluate quality checklist
            → issues? fix → re-screenshot → re-evaluate
              → clean? proceed to next diagram section
```

For multi-diagram canvases, offset each new diagram by 300px+ from the previous one's bounding box.

## Workflow: Multi-Tenancy (Workspaces)

The MCP is multi-tenant. Each Cursor workspace automatically gets its own tenant (identified by a SHA-256 hash of the workspace path). All elements, projects, and snapshots are scoped to the active tenant.

### Automatic Tenant Detection

On MCP startup, the server:
1. Creates a tenant from `process.cwd()` (initial guess)
2. After connecting, calls `server.listRoots()` to get the real workspace path from Cursor
3. If different, re-creates/switches to the correct tenant and notifies the canvas

This means globally-configured MCPs (`~/.cursor/mcp.json`) correctly detect the per-window workspace — no manual setup needed.

### Tenant Operations

| Task | Tool | Notes |
|------|------|-------|
| See all workspaces | `list_tenants` | Returns id, name, workspace_path, created_at |
| Switch workspace | `switch_tenant` with `tenantId` | Canvas reloads that tenant's elements via WebSocket |
| Check current tenant | (from describe_scene or frontend header) | Shows "Workspace: [name]" in canvas |

### Multiple Cursor Instances

Each instance sends its own `X-Tenant-Id` header on every HTTP/MCP request. SQLite uses `busy_timeout` for concurrent write safety. No state conflicts between windows.

## Workflow: Projects (Within a Tenant)

Projects group diagrams within a tenant. Each tenant has a "Default Project" created automatically. Use projects to organize different diagram sets (e.g., "Architecture", "User Flows", "Sprint Planning").

| Task | Tool | Notes |
|------|------|-------|
| List projects | `list_projects` | Shows all projects in active tenant |
| Switch project | `switch_project` with `projectId` | Elements change to that project's set |
| Create new project | `switch_project` with `createName` | Creates and switches in one call |

## Workflow: Search & History

### Full-Text Search

`search_elements` with `query` — searches across element labels and text content in the active project. Useful for finding specific elements in large diagrams.

### Element Version History

`element_history` — view create/update/delete operations for:
- A specific element: pass `elementId`
- Entire active project: omit `elementId`
- Control result count with `limit` (default 50)

Use history to debug unexpected changes or audit what was modified.

## Workflow: Refine An Existing Diagram

1. `describe_scene` to understand current state
2. Identify targets by `id` or label text (or use `search_elements` for text search)
3. `update_element` to move/resize/recolor
4. Screenshot to verify
5. If updates fail: check element id exists (`get_element`), element isn't locked
6. Use `element_history` to see what changed if something looks wrong

## Workflow: File I/O

- Export: `export_scene` (optional `filePath`)
- Import: `import_scene` with `mode: "replace"` or `"merge"`
- Image export: `export_to_image` with `format: "png"` or `"svg"` (requires browser)

## Workflow: Snapshots

1. `snapshot_scene` with a name before risky changes
2. Make changes, screenshot to evaluate
3. `restore_snapshot` to rollback if needed

**Note**: Snapshot restore may not always reload elements into the active view. If the canvas appears empty after restore, re-fetch elements or recreate.

## Workflow: Viewport Control

- `scrollToContent: true` — auto-fit all elements
- `scrollToElementId: "my-element"` — center on specific element
- `zoom: 0.7, offsetX: 100, offsetY: 50` — manual camera for close-up review

## Anti-Patterns (Common Mistakes)

| Mistake | Why It Fails | Do This Instead |
|---------|-------------|-----------------|
| Using `create_from_mermaid` for final diagrams | Overlapping text, poor layout | Use `batch_create_elements` with coordinates |
| Shapes too small for text | Truncation, especially in diamonds | Use sizing formulas above |
| No gap between connected shapes | Arrows become invisible (0px length) | Maintain 120px+ vertical gap |
| Clearing canvas between diagrams | Loses previous work | Place diagrams side-by-side |
| Skipping screenshot verification | Invisible defects compound | Screenshot after EVERY batch |
| Shapes + arrows in one batch | Binding errors | Shapes first, arrows second |
| Default roughness (hand-drawn look) | Unprofessional for technical diagrams | Set `roughness: 0` on all elements |
| Trusting MCP screenshot alone | May return empty image | Use Chrome DevTools as fallback |

## MCP Tool Quick Reference (32 Tools)

| Category | Tools |
|----------|-------|
| Element CRUD (9) | `create_element`, `get_element`, `update_element`, `delete_element`, `query_elements`, `batch_create_elements`, `duplicate_elements`, `search_elements`, `element_history` |
| Layout (6) | `align_elements`, `distribute_elements`, `group_elements`, `ungroup_elements`, `lock_elements`, `unlock_elements` |
| Scene (4) | `describe_scene`, `get_canvas_screenshot`, `get_resource`, `read_diagram_guide` |
| File I/O (4) | `export_scene`, `import_scene`, `export_to_image`, `export_to_excalidraw_url` |
| State (3) | `clear_canvas`, `snapshot_scene`, `restore_snapshot` |
| Viewport (1) | `set_viewport` |
| Tenants (2) | `list_tenants`, `switch_tenant` |
| Projects (2) | `list_projects`, `switch_project` |
| Conversion (1) | `create_from_mermaid` (⚠ low quality — use `batch_create_elements` instead) |

## References

- `references/cheatsheet.md`: Complete MCP tool list (32 tools) + REST API endpoints + payload shapes + env vars
