# Excalidraw MCP Server & Agent Skill

[![CI](https://github.com/yctimlin/mcp_excalidraw/actions/workflows/ci.yml/badge.svg)](https://github.com/yctimlin/mcp_excalidraw/actions/workflows/ci.yml)
[![Docker Build & Push](https://github.com/yctimlin/mcp_excalidraw/actions/workflows/docker.yml/badge.svg)](https://github.com/yctimlin/mcp_excalidraw/actions/workflows/docker.yml)
[![NPM Version](https://img.shields.io/npm/v/mcp-excalidraw-server)](https://www.npmjs.com/package/mcp-excalidraw-server)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Run a live Excalidraw canvas and control it from AI agents. This repo provides:

- **MCP Server**: Connect via Model Context Protocol (Claude Desktop, Cursor, Codex CLI, etc.)
- **Agent Skill**: Portable skill for Claude Code, Codex CLI, and other skill-enabled agents

Keywords: Excalidraw agent skill, Excalidraw MCP server, AI diagramming, Claude Code skill, Codex CLI skill, Claude Desktop MCP, Cursor MCP, Mermaid to Excalidraw.

## Demo

[![MCP Excalidraw Demo](https://img.youtube.com/vi/RRN7AF7QIew/maxresdefault.jpg)](https://youtu.be/RRN7AF7QIew)

*Watch AI agents create and manipulate diagrams in real-time on the live canvas*

## Table of Contents

- [Demo](#demo)
- [What It Is](#what-it-is)
- [What's New](#whats-new)
- [Quick Start (Local)](#quick-start-local)
- [Quick Start (Docker)](#quick-start-docker)
- [Configure MCP Clients](#configure-mcp-clients)
  - [Claude Desktop](#claude-desktop)
  - [Claude Code](#claude-code)
  - [Cursor](#cursor)
  - [Codex CLI](#codex-cli)
  - [OpenCode](#opencode)
  - [Antigravity (Google)](#antigravity-google)
- [Agent Skill (Optional)](#agent-skill-optional)
- [MCP Tools (High Level)](#mcp-tools-high-level)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Known Issues / TODO](#known-issues--todo)
- [Development](#development)

## What It Is

This repo contains two separate processes:

- Canvas server: web UI + REST API + WebSocket updates (default `http://localhost:3000`)
- MCP server: exposes MCP tools over stdio; syncs to the canvas via `EXPRESS_SERVER_URL`

## What's New

- Agent skill: `skills/excalidraw-skill/` (portable instructions + helper scripts for export/import and repeatable CRUD)
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

## Configure MCP Clients

The MCP server runs over stdio and can be configured with any MCP-compatible client. Below are configurations for both **local** (requires cloning and building) and **Docker** (pull-and-run) setups.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `EXPRESS_SERVER_URL` | URL of the canvas server | `http://localhost:3000` |
| `ENABLE_CANVAS_SYNC` | Enable real-time canvas sync | `true` |

---

### Claude Desktop

Config location:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

**Local (node)**
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

**Docker**
```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "EXPRESS_SERVER_URL=http://host.docker.internal:3000",
        "-e", "ENABLE_CANVAS_SYNC=true",
        "ghcr.io/yctimlin/mcp_excalidraw:latest"
      ]
    }
  }
}
```

---

### Claude Code

Use the `claude mcp add` command to register the MCP server.

**Local (node)** - User-level (available across all projects):
```bash
claude mcp add excalidraw --scope user \
  -e EXPRESS_SERVER_URL=http://localhost:3000 \
  -e ENABLE_CANVAS_SYNC=true \
  -- node /absolute/path/to/mcp_excalidraw/dist/index.js
```

**Local (node)** - Project-level (shared via `.mcp.json`):
```bash
claude mcp add excalidraw --scope project \
  -e EXPRESS_SERVER_URL=http://localhost:3000 \
  -e ENABLE_CANVAS_SYNC=true \
  -- node /absolute/path/to/mcp_excalidraw/dist/index.js
```

**Docker**
```bash
claude mcp add excalidraw --scope user \
  -- docker run -i --rm \
  -e EXPRESS_SERVER_URL=http://host.docker.internal:3000 \
  -e ENABLE_CANVAS_SYNC=true \
  ghcr.io/yctimlin/mcp_excalidraw:latest
```

**Manage servers:**
```bash
claude mcp list              # List configured servers
claude mcp remove excalidraw # Remove a server
```

---

### Cursor

Config location: `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` for global config)

**Local (node)**
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

**Docker**
```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "EXPRESS_SERVER_URL=http://host.docker.internal:3000",
        "-e", "ENABLE_CANVAS_SYNC=true",
        "ghcr.io/yctimlin/mcp_excalidraw:latest"
      ]
    }
  }
}
```

---

### Codex CLI

Use the `codex mcp add` command to register the MCP server.

**Local (node)**
```bash
codex mcp add excalidraw \
  --env EXPRESS_SERVER_URL=http://localhost:3000 \
  --env ENABLE_CANVAS_SYNC=true \
  -- node /absolute/path/to/mcp_excalidraw/dist/index.js
```

**Docker**
```bash
codex mcp add excalidraw \
  -- docker run -i --rm \
  -e EXPRESS_SERVER_URL=http://host.docker.internal:3000 \
  -e ENABLE_CANVAS_SYNC=true \
  ghcr.io/yctimlin/mcp_excalidraw:latest
```

**Manage servers:**
```bash
codex mcp list              # List configured servers
codex mcp remove excalidraw # Remove a server
```

---

### OpenCode

Config location: `~/.config/opencode/opencode.json` or project-level `opencode.json`

**Local (node)**
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "excalidraw": {
      "type": "local",
      "command": ["node", "/absolute/path/to/mcp_excalidraw/dist/index.js"],
      "enabled": true,
      "environment": {
        "EXPRESS_SERVER_URL": "http://localhost:3000",
        "ENABLE_CANVAS_SYNC": "true"
      }
    }
  }
}
```

**Docker**
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "excalidraw": {
      "type": "local",
      "command": ["docker", "run", "-i", "--rm", "-e", "EXPRESS_SERVER_URL=http://host.docker.internal:3000", "-e", "ENABLE_CANVAS_SYNC=true", "ghcr.io/yctimlin/mcp_excalidraw:latest"],
      "enabled": true
    }
  }
}
```

---

### Antigravity (Google)

Config location: `~/.gemini/antigravity/mcp_config.json`

**Local (node)**
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

**Docker**
```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "EXPRESS_SERVER_URL=http://host.docker.internal:3000",
        "-e", "ENABLE_CANVAS_SYNC=true",
        "ghcr.io/yctimlin/mcp_excalidraw:latest"
      ]
    }
  }
}
```

---

### Notes

- **Docker networking**: Use `host.docker.internal` to reach the canvas server running on your host machine. On Linux, you may need `--add-host=host.docker.internal:host-gateway` or use `172.17.0.1`.
- **Canvas server**: Must be running before the MCP server connects. Start it with `npm run canvas` (local) or `docker run -d -p 3000:3000 ghcr.io/yctimlin/mcp_excalidraw-canvas:latest` (Docker).
- **Absolute paths**: When using local node setup, replace `/absolute/path/to/mcp_excalidraw` with the actual path where you cloned and built the repo.
- **In-memory storage**: The canvas server stores elements in memory. Restarting the server will clear all elements. Use the export/import scripts if you need persistence.

## Agent Skill (Optional)

This repo includes a skill at `skills/excalidraw-skill/` that provides:

- **Workflow playbook** (`SKILL.md`): step-by-step guidance for drawing, refining, and exporting diagrams
- **Cheatsheet** (`references/cheatsheet.md`): MCP tool and REST API reference
- **Helper scripts** (`scripts/*.cjs`): export, import, clear, healthcheck, CRUD operations

The skill complements the MCP server by giving your AI agent structured workflows to follow.

### Install The Skill (Codex CLI example)

```bash
mkdir -p ~/.codex/skills
cp -R skills/excalidraw-skill ~/.codex/skills/excalidraw-skill
```

To update an existing installation, remove the old folder first (`rm -rf ~/.codex/skills/excalidraw-skill`) then re-copy.

### Install The Skill (Claude Code)

**User-level** (available across all your projects):
```bash
mkdir -p ~/.claude/skills
cp -R skills/excalidraw-skill ~/.claude/skills/excalidraw-skill
```

**Project-level** (scoped to a specific project, can be committed to the repo):
```bash
mkdir -p /path/to/your/project/.claude/skills
cp -R skills/excalidraw-skill /path/to/your/project/.claude/skills/excalidraw-skill
```

Then invoke the skill in Claude Code with `/excalidraw-skill`.

To update an existing installation, remove the old folder first then re-copy.

### Use The Skill Scripts

All scripts respect `EXPRESS_SERVER_URL` (default `http://localhost:3000`) or accept `--url`.

```bash
EXPRESS_SERVER_URL=http://127.0.0.1:3000 node skills/excalidraw-skill/scripts/healthcheck.cjs
EXPRESS_SERVER_URL=http://127.0.0.1:3000 node skills/excalidraw-skill/scripts/export-elements.cjs --out diagram.elements.json
EXPRESS_SERVER_URL=http://127.0.0.1:3000 node skills/excalidraw-skill/scripts/import-elements.cjs --in diagram.elements.json --mode batch
```

### When The Skill Is Useful

- Repository workflow: export elements as JSON, commit it, and re-import later.
- Reliable refactors: clear + re-import in `sync` mode to make canvas match a file.
- Automated smoke tests: create/update/delete a known element to validate a deployment.
- Repeatable diagrams: keep a library of element JSON snippets and import them.

See `skills/excalidraw-skill/SKILL.md` and `skills/excalidraw-skill/references/cheatsheet.md`.

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

## Known Issues / TODO

The following issues are known and tracked for future improvement:

- [ ] **`align_elements` / `distribute_elements` are stubs**: These tools log and return success but do not actually move elements. Implementation needed in `src/index.ts:782-806`.
- [ ] **`points` type mismatch**: The Zod schema expects `[{x, y}]` objects but Excalidraw expects `[[x, y]]` tuples. This may cause issues when creating arrows/lines via MCP. See `src/index.ts:187` vs `src/types.ts:64`.
- [ ] **`label` element type incomplete**: The `label` type is defined in `EXCALIDRAW_ELEMENT_TYPES` but has no corresponding interface in the type union. See `src/types.ts:109,118`.
- [ ] **HTTP transport mode placeholder**: `MCP_TRANSPORT_MODE=http` is accepted but falls back to stdio. See `src/index.ts:989-996`.
- [ ] **`ungroup_elements` silent success**: Returns success even when no elements are ungrouped (e.g., elements not found). See `src/index.ts:765-769`.

Contributions welcome!

## Development

```bash
npm run type-check
npm run build
```
