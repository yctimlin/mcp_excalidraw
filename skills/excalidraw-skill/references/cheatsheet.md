# Excalidraw Skill Cheatsheet

## Defaults

- Canvas base URL: configurable via `CANVAS_PORT` env var (default `3000`), resolves to `http://localhost:<CANVAS_PORT>`
- Canvas health: `GET /health`
- Data persistence: SQLite database at `~/.excalidraw-mcp/excalidraw.db`
- Multi-tenancy: each Cursor workspace auto-creates a tenant (hash of workspace path)

## MCP Tools (32 total)

### Element CRUD

| Tool | Description | Required params |
|------|-------------|-----------------|
| `create_element` | Create shape/text/arrow/line | `type`, `x`, `y` |
| `get_element` | Get single element by ID | `id` |
| `update_element` | Update element properties | `id` |
| `delete_element` | Delete element | `id` |
| `query_elements` | Query by type | (optional) `type` |
| `batch_create_elements` | Create many at once (recommended) | `elements[]` |
| `duplicate_elements` | Clone with offset | `elementIds[]`, (optional) `offsetX`, `offsetY` |
| `search_elements` | Full-text search over labels/text | `query` |
| `element_history` | View version history (create/update/delete ops) | (optional) `elementId`, `limit` (default 50) |

### Layout & Organization

| Tool | Description | Required params |
|------|-------------|-----------------|
| `align_elements` | Align to left/center/right/top/middle/bottom | `elementIds[]`, `alignment` |
| `distribute_elements` | Even spacing horizontal/vertical | `elementIds[]`, `direction` |
| `group_elements` | Group elements | `elementIds[]` |
| `ungroup_elements` | Ungroup | `groupId` |
| `lock_elements` | Lock elements | `elementIds[]` |
| `unlock_elements` | Unlock elements | `elementIds[]` |

### Scene Awareness (Iterative Refinement)

| Tool | Description | Required params |
|------|-------------|-----------------|
| `describe_scene` | AI-readable scene description (types, positions, labels, connections, bounding box) | (none) |
| `get_canvas_screenshot` | Returns PNG image of canvas for visual verification (may return empty — use Chrome DevTools as fallback) | (optional) `background` |
| `get_resource` | Get scene/library/theme/elements | `resource` |
| `read_diagram_guide` | Get design best practices (colors, sizing, layout, anti-patterns) | (none) |

### File I/O & Export

| Tool | Description | Required params |
|------|-------------|-----------------|
| `export_scene` | Export to .excalidraw JSON | (optional) `filePath` |
| `import_scene` | Import from .excalidraw JSON | `mode` ("replace"\|"merge"), `filePath` or `data` |
| `export_to_image` | Export to PNG/SVG (needs browser) | `format` ("png"\|"svg"), (optional) `filePath`, `background` |
| `export_to_excalidraw_url` | Upload & get shareable excalidraw.com URL (may fail if org blocks excalidraw.com) | (none) |

### State Management

| Tool | Description | Required params |
|------|-------------|-----------------|
| `clear_canvas` | Remove all elements from active project | (none) |
| `snapshot_scene` | Save named snapshot of current canvas state | `name` |
| `restore_snapshot` | Restore from snapshot (may not reload into view — re-fetch if canvas appears empty) | `name` |

### Viewport & Camera

| Tool | Description | Required params |
|------|-------------|-----------------|
| `set_viewport` | Control camera: zoom-to-fit, center on element, manual zoom/scroll (needs browser) | (optional) `scrollToContent`, `scrollToElementId`, `zoom`, `offsetX`, `offsetY` |

### Multi-Tenancy (Workspaces)

| Tool | Description | Required params |
|------|-------------|-----------------|
| `list_tenants` | List all tenants (workspaces). Each tenant maps to a Cursor workspace. | (none) |
| `switch_tenant` | Switch active tenant. All later operations use that tenant's projects/elements. | `tenantId` |

### Projects (Within a Tenant)

| Tool | Description | Required params |
|------|-------------|-----------------|
| `list_projects` | List all diagram projects in the active tenant | (none) |
| `switch_project` | Switch active project or create a new one | (optional) `projectId`, `createName`, `createDescription` |

### Conversion

| Tool | Description | Required params |
|------|-------------|-----------------|
| `create_from_mermaid` | Mermaid diagram to Excalidraw (⚠ produces low-quality output — use `batch_create_elements` for production diagrams) | `mermaidDiagram` |

## Key Notes

### MCP vs REST API Format Differences

| Concept | MCP Tool Format | REST API Format |
|---------|----------------|-----------------|
| Shape labels | `"text": "My Label"` (auto-converts) | `"label": {"text": "My Label"}` |
| Arrow binding | `"startElementId": "id"` / `"endElementId": "id"` | `"start": {"id": "id"}` / `"end": {"id": "id"}` |
| `fontFamily` | String `"1"` or omit | String `"1"` or omit (never a number) |
| Tenant scoping | Auto (uses active tenant) | Include `X-Tenant-Id` header on every request |

### Element Creation Best Practices

- **Always set `roughness: 0`** for clean, professional diagrams (default is hand-drawn).
- **Always set `strokeWidth: 2`** on arrows for visibility.
- **Create shapes first, arrows second** (two separate `batch_create_elements` calls).
- **Assign custom `id`** to every shape so arrows can reference it.
- **Size shapes for their text** — Virgil font is ~30% wider than standard. Use sizing formulas from SKILL.md.
- `points` accepts both `[[x,y]]` tuples and `[{x,y}]` objects — normalized automatically.
- **Curved arrows**: Use `"roundness": {"type": 2}` with 3+ points. **Elbowed arrows**: Use `"elbowed": true`.

### Multi-Tenancy Architecture

- **Tenant**: Maps to a Cursor workspace. Auto-created on MCP startup from workspace path hash.
- **Project**: Groups diagrams within a tenant. Default project created per tenant.
- **Elements**: Belong to the active project within the active tenant.
- **Hierarchy**: Tenant → Project → Elements
- **Concurrent instances**: Multiple Cursor windows each send `X-Tenant-Id` header for isolation. SQLite `busy_timeout` handles concurrent writes.
- **Frontend workspace switcher**: Dropdown in the canvas UI header labeled "Workspace: [name] ▾" with search filter.

## Canvas REST API (HTTP)

All endpoints accept an optional `X-Tenant-Id` header to scope operations to a specific tenant.

### Elements

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/elements` | List all elements in active project |
| `GET` | `/api/elements/:id` | Get element by ID |
| `POST` | `/api/elements` | Create element |
| `PUT` | `/api/elements/:id` | Update element |
| `DELETE` | `/api/elements/:id` | Delete element |
| `DELETE` | `/api/elements/clear` | Clear all elements |
| `GET` | `/api/elements/search?type=...` | Search with filters |
| `POST` | `/api/elements/batch` | Batch create |
| `POST` | `/api/elements/sync` | Full sync (clear + write all elements) |
| `POST` | `/api/elements/from-mermaid` | Mermaid conversion via frontend |

### Tenants

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenants` | List all tenants |
| `GET` | `/api/tenant/active` | Get active tenant |
| `PUT` | `/api/tenant/active` | Switch active tenant `{"tenantId": "..."}` (broadcasts to all WebSocket clients) |

### Export

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/export/image` | Request image export (needs browser) |
| `POST` | `/api/export/image/result` | Frontend posts export result back |

### Viewport

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/viewport` | Set viewport/camera (needs browser) |
| `POST` | `/api/viewport/result` | Frontend posts viewport result back |

### Snapshots

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/snapshots` | Save snapshot `{"name": "..."}` |
| `GET` | `/api/snapshots` | List all snapshots |
| `GET` | `/api/snapshots/:name` | Get snapshot by name |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/sync/status` | Element count and WebSocket stats |

## Skill Scripts

All scripts accept `--url <canvasUrl>` (defaults to `EXPRESS_SERVER_URL`).

```bash
node scripts/healthcheck.cjs
node scripts/clear-canvas.cjs
node scripts/export-elements.cjs --out diagram.elements.json
node scripts/import-elements.cjs --in diagram.elements.json --mode batch|sync
node scripts/create-element.cjs --data '{...}'
node scripts/update-element.cjs --id <id> --data '{...}'
node scripts/delete-element.cjs --id <id>
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CANVAS_PORT` | `3000` | Port the canvas server listens on |
| `EXPRESS_SERVER_URL` | `http://localhost:3000` | Full canvas URL (derived from CANVAS_PORT if not set) |
| `EXCALIDRAW_EXPORT_DIR` | `process.cwd()` | Allowed base directory for file exports (path traversal protection) |
