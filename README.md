# MCP Excalidraw Server (Excalidraw + MCP)

[![CI](https://github.com/yctimlin/mcp_excalidraw/actions/workflows/ci.yml/badge.svg)](https://github.com/yctimlin/mcp_excalidraw/actions/workflows/ci.yml)
[![Docker Build & Push](https://github.com/yctimlin/mcp_excalidraw/actions/workflows/docker.yml/badge.svg)](https://github.com/yctimlin/mcp_excalidraw/actions/workflows/docker.yml)
[![NPM Version](https://img.shields.io/npm/v/mcp-excalidraw-server)](https://www.npmjs.com/package/mcp-excalidraw-server)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Run a live Excalidraw canvas and control it from AI agents via MCP (Model Context Protocol).

Keywords: Excalidraw MCP server, AI diagramming, Claude Desktop MCP, Claude Code MCP, Cursor MCP, MCP Inspector, Mermaid to Excalidraw.

## What It Is

This repo contains two separate processes:

- Canvas server: web UI + REST API + WebSocket updates (default `http://localhost:3000`)
- MCP server: exposes MCP tools over stdio; syncs to the canvas via `EXPRESS_SERVER_URL`

## What's New

- Agent skill: `skills/excalidraw-mcp/` (portable instructions + helper scripts for export/import and repeatable CRUD)
- Better testing loop: MCP Inspector CLI examples + browser screenshot checks (`agent-browser`)
- Bugfixes: batch create now preserves element ids (fixes update/delete after batch); frontend entrypoint fixed (`main.tsx`)

## Quick Start (Local)

Prereqs: Node >= 18, npm

```bash
npm ci
npm run build
```

Terminal 1: start the canvas
```bash
HOST=0.0.0.0 PORT=3000 npm run canvas
```

Open `http://localhost:3000`.

Terminal 2: run the MCP server (stdio)
```bash
EXPRESS_SERVER_URL=http://localhost:3000 node dist/index.js
```

## Quick Start (Docker)

Canvas server:
```bash
docker run -d -p 3000:3000 --name mcp-excalidraw-canvas ghcr.io/yctimlin/mcp_excalidraw-canvas:latest
```

MCP server (stdio) is typically launched by your MCP client (Claude Desktop/Cursor/etc.). If you want a local container for it, use the image `ghcr.io/yctimlin/mcp_excalidraw:latest` and set `EXPRESS_SERVER_URL` to point at the canvas.

## Configure MCP Clients (stdio)

You can point any MCP client at `dist/index.js` (stdio). Example:

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": ["/absolute/path/to/mcp_excalidraw/dist/index.js"],
      "env": {
        "EXPRESS_SERVER_URL": "http://localhost:3000",
        "ENABLE_CANVAS_SYNC": "true"
      }
    }
  }
}
```

This repo includes sample configs:

- `claude_desktop_config.json`
- `.mcp.json` (Claude Code)
- `.cursor/mcp.json` (Cursor)

## Agent Skill (Optional, Recommended)

This repo ships an agent skill at `skills/excalidraw-mcp/`.

Skills are not Codex-specific. This one is a lightweight, portable bundle:

- `skills/excalidraw-mcp/SKILL.md`: the workflow playbook (what to do first/next)
- `skills/excalidraw-mcp/references/cheatsheet.md`: tool + REST endpoint reference
- `skills/excalidraw-mcp/scripts/*.cjs`: helper scripts (export/import/clear/CRUD)

What the skill adds:

- A workflow playbook for drawing/refining diagrams (what to do first, what to do last)
- Helper scripts for export/import and repeatable operations (healthcheck, clear, CRUD)

What the skill is not:

- It does not replace the MCP server; the MCP server is still what exposes tools to an agent.
- It is not required to run the canvas.

### Use The Skill In Any Agent Tool

Most agent tools support one (or more) of these patterns:

1) **Custom instructions / rules / system prompt**
   - Paste the contents of `skills/excalidraw-mcp/SKILL.md` into your agent's custom instructions.
2) **File-backed instructions**
   - Point your agent at the file `skills/excalidraw-mcp/SKILL.md` and tell it to follow it.
3) **"Skill package"**
   - If your agent supports importing a skill bundle, use the `skills/excalidraw-mcp/` folder as the bundle source.

If your agent tool has a concept of "tools", use MCP for the interactive diagram edits and the skill scripts for export/import workflows.

### Install The Skill (Codex CLI example)

```bash
mkdir -p ~/.codex/skills
cp -R skills/excalidraw-mcp ~/.codex/skills/excalidraw-mcp
```

To update an existing installation, remove the old folder first (`rm -rf ~/.codex/skills/excalidraw-mcp`) then re-copy.

### Install The Skill (Claude Code)

**User-level** (available across all your projects):
```bash
mkdir -p ~/.claude/skills
cp -R skills/excalidraw-mcp ~/.claude/skills/excalidraw-mcp
```

**Project-level** (scoped to a specific project, can be committed to the repo):
```bash
mkdir -p /path/to/your/project/.claude/skills
cp -R skills/excalidraw-mcp /path/to/your/project/.claude/skills/excalidraw-mcp
```

Then invoke the skill in Claude Code with `/excalidraw-mcp`.

To update an existing installation, remove the old folder first then re-copy.

### Use The Skill Scripts

All scripts respect `EXPRESS_SERVER_URL` (default `http://localhost:3000`) or accept `--url`.

```bash
EXPRESS_SERVER_URL=http://127.0.0.1:3000 node skills/excalidraw-mcp/scripts/healthcheck.cjs
EXPRESS_SERVER_URL=http://127.0.0.1:3000 node skills/excalidraw-mcp/scripts/export-elements.cjs --out diagram.elements.json
EXPRESS_SERVER_URL=http://127.0.0.1:3000 node skills/excalidraw-mcp/scripts/import-elements.cjs --in diagram.elements.json --mode batch
```

### When The Skill Is Useful

- Repository workflow: export elements as JSON, commit it, and re-import later.
- Reliable refactors: clear + re-import in `sync` mode to make canvas match a file.
- Automated smoke tests: create/update/delete a known element to validate a deployment.
- Repeatable diagrams: keep a library of element JSON snippets and import them.

See `skills/excalidraw-mcp/SKILL.md` and `skills/excalidraw-mcp/references/cheatsheet.md`.

## MCP Tools (High Level)

The MCP server exposes tools such as:

- `create_element`, `update_element`, `delete_element`
- `query_elements`, `get_resource`
- `batch_create_elements`
- `align_elements`, `distribute_elements`
- `group_elements`, `ungroup_elements`
- `lock_elements`, `unlock_elements`
- `create_from_mermaid` (frontend converts Mermaid to Excalidraw elements)

The full tool list and schemas are discoverable via MCP Inspector (`tools/list`) or by reading `src/index.ts`.

## Testing

### Canvas Smoke Test (HTTP)

```bash
curl http://localhost:3000/health
```

### MCP Smoke Test (MCP Inspector)

List tools:
```bash
npx @modelcontextprotocol/inspector --cli \
  -e EXPRESS_SERVER_URL=http://localhost:3000 \
  -e ENABLE_CANVAS_SYNC=true -- \
  node dist/index.js --method tools/list
```

Create a rectangle:
```bash
npx @modelcontextprotocol/inspector --cli \
  -e EXPRESS_SERVER_URL=http://localhost:3000 \
  -e ENABLE_CANVAS_SYNC=true -- \
  node dist/index.js --method tools/call --tool-name create_element \
  --tool-arg type=rectangle --tool-arg x=100 --tool-arg y=100 \
  --tool-arg width=300 --tool-arg height=200
```

### Frontend Screenshots (agent-browser)

If you use `agent-browser` for UI checks:
```bash
agent-browser install
agent-browser open http://127.0.0.1:3000
agent-browser wait --load networkidle
agent-browser screenshot /tmp/canvas.png
```

## Troubleshooting

- Canvas not updating: confirm `EXPRESS_SERVER_URL` points at the running canvas server.
- Updates/deletes fail after batch creation: ensure you are on a build that includes the batch id preservation fix (merged via PR #34).

## Development

```bash
npm run type-check
npm run build
```
