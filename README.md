# MCP Excalidraw Server: Advanced Live Visual Diagramming with AI Integration

[![CI](https://github.com/yctimlin/mcp_excalidraw/actions/workflows/ci.yml/badge.svg)](https://github.com/yctimlin/mcp_excalidraw/actions/workflows/ci.yml)
[![Docker Build & Push](https://github.com/yctimlin/mcp_excalidraw/actions/workflows/docker.yml/badge.svg)](https://github.com/yctimlin/mcp_excalidraw/actions/workflows/docker.yml)
[![NPM Version](https://img.shields.io/npm/v/mcp-excalidraw-server)](https://www.npmjs.com/package/mcp-excalidraw-server)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A comprehensive **TypeScript-based** system that combines **Excalidraw's powerful drawing capabilities** with **Model Context Protocol (MCP)** integration, enabling AI agents to create and manipulate diagrams in real-time on a live canvas.

## 🚦 Current Status & Version Information

> **📋 Choose Your Installation Method**

| Component | Local | Docker | Status |
|-----------|-------|--------|--------|
| **Canvas Server** | ✅ Fully Working | ✅ Fully Working | **Production Ready** |
| **MCP Server** | ✅ Fully Working | ✅ Fully Working | **Production Ready** |
| **NPM Published** | 🔧 In Progress | N/A | Development testing |

### **Important: Canvas and MCP Server Run Separately**

This system consists of **two independent components**:

1. **Canvas Server** - Runs the live Excalidraw canvas (web interface)
2. **MCP Server** - Connects to Claude Desktop/Claude Code/Cursor IDE

**You can choose any combination:**
- Canvas: Local OR Docker
- MCP Server: Local OR Docker

Both local and Docker setups are **fully working** and production-ready!

## 🚀 What This System Does

- **🎨 Live Canvas**: Real-time Excalidraw canvas accessible via web browser
- **🤖 AI Integration**: MCP server allows AI agents (like Claude) to create visual diagrams
- **⚡ Real-time Sync**: Elements created via MCP API appear instantly on the canvas
- **🔄 WebSocket Updates**: Live synchronization across multiple connected clients
- **🏗️ Production Ready**: Clean, minimal UI suitable for end users

## 🎥 Demo Video

> **See MCP Excalidraw in Action!**

[![MCP Excalidraw Demo](https://img.youtube.com/vi/RRN7AF7QIew/maxresdefault.jpg)](https://youtu.be/RRN7AF7QIew)

*Watch how AI agents create and manipulate diagrams in real-time on the live canvas*

## 🏛️ Architecture Overview

### **Two Independent Components**

```
┌─────────────────────────────────────────────────────────────────┐
│                         Component 1                              │
│                     🎨 CANVAS SERVER                             │
│                   (Runs Independently)                           │
│                                                                  │
│  ┌─────────────────┐         ┌─────────────────┐               │
│  │  Canvas Server  │◀───────▶│   Frontend      │               │
│  │ (src/server.js) │         │  (React + WS)   │               │
│  │  Port 3000      │         │  Excalidraw UI  │               │
│  └─────────────────┘         └─────────────────┘               │
│                                                                  │
│  📍 Start: npm run canvas  OR  docker run (canvas)              │
└─────────────────────────────────────────────────────────────────┘

                              ▲
                              │ HTTP API
                              │ (Optional)
                              │
┌─────────────────────────────────────────────────────────────────┐
│                         Component 2                              │
│                      🤖 MCP SERVER                               │
│                   (Runs Independently)                           │
│                                                                  │
│  ┌─────────────────┐         ┌─────────────────┐               │
│  │   AI Agent      │◀───────▶│   MCP Server    │               │
│  │   (Claude)      │         │ (src/index.js)  │               │
│  │  Desktop/Code   │  stdio  │  MCP Protocol   │               │
│  └─────────────────┘         └─────────────────┘               │
│                                                                  │
│  📍 Configure in: claude_desktop_config.json OR .mcp.json       │
└─────────────────────────────────────────────────────────────────┘

🎯 Key Points:
• Canvas and MCP server are SEPARATE processes
• Canvas can run locally OR in Docker
• MCP server can run locally OR in Docker
• Canvas provides the visual interface (optional)
• MCP server connects Claude to the canvas (via HTTP API)
```

## 🌟 Key Features

### **Modern TypeScript Architecture**
- **Full TypeScript Migration**: Complete type safety for backend and frontend
- **Comprehensive Type Definitions**: Excalidraw elements, API responses, WebSocket messages
- **Strict Type Checking**: Enhanced development experience and compile-time error detection
- **Type-Safe React Components**: TSX components with proper props typing

### **Real-time Canvas Integration**
- Elements created via MCP appear instantly on the live canvas
- WebSocket-based real-time synchronization
- Multi-client support with live updates

### **Production-Ready Interface**
- Clean, minimal UI with connection status
- Simple "Clear Canvas" functionality
- No development clutter or debug information

### **Comprehensive MCP API**
- **Element Creation**: rectangles, ellipses, diamonds, arrows, text, lines
- **Element Management**: update, delete, query with filters
- **Batch Operations**: create multiple elements in one call
- **Advanced Features**: grouping, alignment, distribution, locking

### **Robust Architecture**
- TypeScript-based Express.js backend with REST API + WebSocket
- React frontend with official Excalidraw package and TypeScript
- Dual-path element loading for reliability
- Auto-reconnection and error handling

## 📦 Installation & Setup

### **Step 1: Choose Your Canvas Server Setup**

The canvas server provides the live Excalidraw interface.

#### **Option A: Local Canvas Server**

1. **Clone and Install**
```bash
git clone https://github.com/yctimlin/mcp_excalidraw.git
cd mcp_excalidraw
npm install
```

2. **Build the Project**
```bash
npm run build
```

3. **Start Canvas Server**
```bash
# Production mode (recommended)
npm run canvas
```

4. **Access the Canvas**
```
http://localhost:3000
```

#### **Option B: Docker Canvas Server**

**Option B1: Use Pre-built Image from GHCR** (Recommended)
```bash
docker pull ghcr.io/yctimlin/mcp_excalidraw-canvas:latest
docker run -d -p 3000:3000 --name mcp-excalidraw-canvas ghcr.io/yctimlin/mcp_excalidraw-canvas:latest
```

**Option B2: Build Locally**
```bash
git clone https://github.com/yctimlin/mcp_excalidraw.git
cd mcp_excalidraw
docker build -f Dockerfile.canvas -t mcp-excalidraw-canvas .
docker run -d -p 3000:3000 --name mcp-excalidraw-canvas mcp-excalidraw-canvas
```

3. **Access the Canvas**
```
http://localhost:3000
```

---

### **Step 2: Configure MCP Server in Your IDE**

The MCP server connects your AI assistant (Claude) to the canvas. **Choose local OR Docker format** based on your preference.

#### **Setup Combinations**

You can mix and match any combination:

| Canvas Server | MCP Server | Status |
|---------------|------------|--------|
| ✅ Local | ✅ Local | Recommended |
| ✅ Local | ✅ Docker | Fully Working |
| ✅ Docker | ✅ Local | Fully Working |
| ✅ Docker | ✅ Docker | Fully Working |

Configuration examples are provided in the next section for:
- Claude Desktop
- Claude Code
- Cursor IDE

## 🔧 Available Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Build and start MCP server (`dist/index.js`) |
| `npm run canvas` | Build and start canvas server (`dist/server.js`) |
| `npm run build` | Build both frontend and TypeScript backend |
| `npm run build:frontend` | Build React frontend only |
| `npm run build:server` | Compile TypeScript backend to JavaScript |
| `npm run dev` | Start TypeScript watch mode + Vite dev server |
| `npm run type-check` | Run TypeScript type checking without compilation |
| `npm run production` | Build + start in production mode |

## 🎯 Usage Guide

### **For End Users**
1. Open the canvas at `http://localhost:3000`
2. Check connection status (should show "Connected")
3. AI agents can now create diagrams that appear in real-time
4. Use "Clear Canvas" to remove all elements

### **For AI Agents (via MCP)**
The MCP server provides these tools for creating visual diagrams:

#### **Basic Element Creation**
```javascript
// Create a rectangle
{
  "type": "rectangle",
  "x": 100,
  "y": 100, 
  "width": 200,
  "height": 100,
  "backgroundColor": "#e3f2fd",
  "strokeColor": "#1976d2",
  "strokeWidth": 2
}
```

#### **Create Text Elements**
```javascript
{
  "type": "text",
  "x": 150,
  "y": 125,
  "text": "Process Step",
  "fontSize": 16,
  "strokeColor": "#333333"
}
```

#### **Create Arrows & Lines**
```javascript
{
  "type": "arrow",
  "x": 300,
  "y": 130,
  "width": 100,
  "height": 0,
  "strokeColor": "#666666",
  "strokeWidth": 2
}
```

#### **Batch Creation for Complex Diagrams**
```javascript
{
  "elements": [
    {
      "type": "rectangle",
      "x": 100,
      "y": 100,
      "width": 120,
      "height": 60,
      "backgroundColor": "#fff3e0",
      "strokeColor": "#ff9800"
    },
    {
      "type": "text", 
      "x": 130,
      "y": 125,
      "text": "Start",
      "fontSize": 16
    }
  ]
}
```

## 🔌 MCP Server Configuration for IDEs

### **Prerequisites**
✅ Ensure your **canvas server is running** (from Step 1):
- Local: `npm run canvas`
- Docker: `docker run -d -p 3000:3000 mcp-excalidraw-canvas`

Canvas should be accessible at http://localhost:3000

### **Quick Reference**

Choose your configuration based on IDE and preference:

| IDE | Config File | Format Options |
|-----|-------------|----------------|
| **Claude Desktop** | `claude_desktop_config.json` | Local ⭐ / Docker ✅ |
| **Claude Code** | `.mcp.json` (project root) | Local ⭐ / Docker ✅ |
| **Cursor** | `.cursor/mcp.json` | Local ⭐ / Docker ✅ |

⭐ = Recommended | ✅ = Fully Working

---

## **Configuration for Claude Desktop**

Edit your `claude_desktop_config.json` file:

### **Format 1: Local MCP Server** ⭐ Recommended

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

**Important:** Replace `/absolute/path/to/mcp_excalidraw` with your actual installation path.

### **Format 2: Docker MCP Server** ✅ Fully Working

**Using Pre-built Image from GHCR** (Recommended):
```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--network", "host",
        "-e", "EXPRESS_SERVER_URL=http://localhost:3000",
        "-e", "ENABLE_CANVAS_SYNC=true",
        "ghcr.io/yctimlin/mcp_excalidraw:latest"
      ]
    }
  }
}
```

**OR Build Locally**:
```bash
cd mcp_excalidraw
docker build -f Dockerfile -t mcp-excalidraw .
```

Then use `mcp-excalidraw` as the image name in the configuration above.

---

## **Configuration for Claude Code**

Create or edit `.mcp.json` in your project root:

### **Format 1: Local MCP Server** ⭐ Recommended

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

**Important:** Replace `/absolute/path/to/mcp_excalidraw` with your actual installation path.

### **Format 2: Docker MCP Server** ✅ Fully Working

**Using Pre-built Image from GHCR** (Recommended):
```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--network", "host",
        "-e", "EXPRESS_SERVER_URL=http://localhost:3000",
        "-e", "ENABLE_CANVAS_SYNC=true",
        "ghcr.io/yctimlin/mcp_excalidraw:latest"
      ]
    }
  }
}
```

**OR Build Locally**:
```bash
cd mcp_excalidraw
docker build -f Dockerfile -t mcp-excalidraw .
```

Then use `mcp-excalidraw` as the image name in the configuration above.

### **Alternative: Using Claude CLI**

```bash
# Project-scoped (recommended)
claude mcp add --scope project --transport stdio excalidraw \
  -- docker run -i --rm --network host \
  -e EXPRESS_SERVER_URL=http://localhost:3000 \
  -e ENABLE_CANVAS_SYNC=true \
  mcp-excalidraw

# User-scoped (available across all projects)
claude mcp add --scope user --transport stdio excalidraw \
  -- docker run -i --rm --network host \
  -e EXPRESS_SERVER_URL=http://localhost:3000 \
  -e ENABLE_CANVAS_SYNC=true \
  mcp-excalidraw
```

---

## **Configuration for Cursor IDE**

Edit `.cursor/mcp.json`:

### **Format 1: Local MCP Server** ⭐ Recommended

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

### **Format 2: Docker MCP Server** ✅ Fully Working

**Using Pre-built Image from GHCR** (Recommended):
```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--network", "host",
        "-e", "EXPRESS_SERVER_URL=http://localhost:3000",
        "-e", "ENABLE_CANVAS_SYNC=true",
        "ghcr.io/yctimlin/mcp_excalidraw:latest"
      ]
    }
  }
}
```

**OR Build Locally**:
```bash
cd mcp_excalidraw
docker build -f Dockerfile -t mcp-excalidraw .
```

Then use `mcp-excalidraw` as the image name in the configuration above.

---

## **Important Configuration Notes**

| Setting | Purpose | Required |
|---------|---------|----------|
| `EXPRESS_SERVER_URL` | Canvas server URL | Yes (default: http://localhost:3000) |
| `ENABLE_CANVAS_SYNC` | Enable real-time canvas sync | Yes (set to "true") |
| `--network host` | Docker access to localhost | Required for Docker |
| `-i` flag | Interactive stdin/stdout | Required for Docker |

**Canvas is optional**: The MCP server works without the canvas in API-only mode (for programmatic access only).

## 🛠️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EXPRESS_SERVER_URL` | `http://localhost:3000` | Canvas server URL for MCP sync |
| `ENABLE_CANVAS_SYNC` | `true` | Enable/disable canvas synchronization |
| `LOG_FILE_PATH` | `excalidraw.log` | Path to the log file |
| `DEBUG` | `false` | Enable debug logging |
| `PORT` | `3000` | Canvas server port |
| `HOST` | `localhost` | Canvas server host |

## 📊 API Endpoints

The canvas server provides these REST endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/elements` | Get all elements |
| `POST` | `/api/elements` | Create new element |
| `PUT` | `/api/elements/:id` | Update element |
| `DELETE` | `/api/elements/:id` | Delete element |
| `POST` | `/api/elements/batch` | Create multiple elements |
| `GET` | `/health` | Server health check |

## 🎨 MCP Tools Available

### **Element Management**
- `create_element` - Create any type of Excalidraw element
- `update_element` - Modify existing elements
- `delete_element` - Remove elements
- `query_elements` - Search elements with filters

### **Batch Operations**
- `batch_create_elements` - Create complex diagrams in one call

### **Element Organization**  
- `group_elements` - Group multiple elements
- `ungroup_elements` - Ungroup element groups
- `align_elements` - Align elements (left, center, right, top, middle, bottom)
- `distribute_elements` - Distribute elements evenly
- `lock_elements` / `unlock_elements` - Lock/unlock elements

### **Resource Access**
- `get_resource` - Access scene, library, theme, or elements data

## 🏗️ Development Architecture

### **Frontend** (`frontend/src/`)
- **React + TypeScript**: Modern TSX components with full type safety
- **Vite Build System**: Fast development and optimized production builds
- **Official Excalidraw**: `@excalidraw/excalidraw` package with TypeScript types
- **WebSocket Client**: Type-safe real-time element synchronization
- **Clean UI**: Production-ready interface with proper TypeScript typing

### **Canvas Server** (`src/server.ts` → `dist/server.js`)
- **TypeScript + Express.js**: Fully typed REST API + static file serving
- **WebSocket**: Type-safe real-time client communication  
- **Element Storage**: In-memory with comprehensive type definitions
- **CORS**: Cross-origin support with proper typing

### **MCP Server** (`src/index.ts` → `dist/index.js`)
- **TypeScript MCP Protocol**: Type-safe Model Context Protocol implementation
- **Canvas Sync**: Strongly typed HTTP requests to canvas server
- **Element Management**: Full CRUD operations with comprehensive type checking
- **Batch Support**: Type-safe complex diagram creation

### **Type System** (`src/types.ts`)
- **Excalidraw Element Types**: Complete type definitions for all element types
- **API Response Types**: Strongly typed REST API interfaces
- **WebSocket Message Types**: Type-safe real-time communication
- **Server Element Types**: Enhanced element types with metadata

## 🐛 Troubleshooting

### **Canvas Not Loading**
- Ensure `npm run build` completed successfully
- Check that `dist/index.html` and `dist/frontend/` directory exist
- Verify canvas server is running on port 3000
- Check if port 3000 is already in use: `lsof -i :3000` (macOS/Linux) or `netstat -ano | findstr :3000` (Windows)

### **Elements Not Syncing**
- Confirm canvas server is running and accessible at http://localhost:3000
- Check `ENABLE_CANVAS_SYNC=true` in MCP server environment configuration
- Verify `EXPRESS_SERVER_URL` points to correct canvas server URL
- Check browser console for WebSocket connection errors
- For Docker: Ensure `--network host` flag is used

### **WebSocket Connection Issues**
- Check browser console for WebSocket errors (F12 → Console tab)
- Ensure no firewall blocking WebSocket connections on port 3000
- Try refreshing the browser page
- Verify canvas server is running: `curl http://localhost:3000/health`

### **Docker Issues**

**Canvas Container:**
- Check if container is running: `docker ps | grep canvas`
- View logs: `docker logs mcp-excalidraw-canvas`
- Ensure port 3000 is not already in use

**MCP Container:**
- For Docker MCP server, ensure `--network host` is used (required to access localhost:3000)
- Verify `-i` flag is present (required for MCP stdin/stdout protocol)
- Check environment variables are properly set

### **Build Errors**
- Delete `node_modules` and `dist/` directories, then run `npm install && npm run build`
- Check Node.js version (requires 16+): `node --version`
- Run `npm run type-check` to identify TypeScript issues
- Verify `dist/` directory contains both `index.js`, `server.js`, and `frontend/` after build

### **NPM Package Issues**
- **Status**: NPM package is under development
- **Recommendation**: Use local or Docker installation methods for production use

## 📋 Project Structure

```
mcp_excalidraw/
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Main React component (TypeScript)
│   │   └── main.tsx         # React entry point (TypeScript)
│   └── index.html           # HTML template
├── src/ (TypeScript Source)
│   ├── index.ts            # MCP server (TypeScript)
│   ├── server.ts           # Canvas server (Express + WebSocket, TypeScript)
│   ├── types.ts            # Comprehensive type definitions
│   └── utils/
│       └── logger.ts       # Logging utility (TypeScript)
├── dist/ (Compiled Output)
│   ├── index.js            # Compiled MCP server
│   ├── server.js           # Compiled Canvas server
│   ├── types.js            # Compiled type definitions
│   ├── utils/
│   │   └── logger.js       # Compiled logging utility
│   └── frontend/           # Built React frontend
├── tsconfig.json          # TypeScript configuration
├── vite.config.js         # Vite build configuration
├── package.json           # Dependencies and scripts
└── README.md              # This file
```

## 🔮 Development Roadmap

- ✅ **TypeScript Migration**: Complete type safety for enhanced development experience
- ✅ **Docker Deployment**: Both Canvas and MCP server fully working in Docker
- 🔧 **NPM Package**: Resolving MCP tool registration issues
- 🎯 **Enhanced Features**: Additional MCP tools and capabilities
- 🎯 **Performance Optimization**: Real-time sync improvements
- 🎯 **Advanced TypeScript Features**: Stricter type checking and advanced type utilities
- 🎯 **Container Registry**: Publishing to GitHub Container Registry (GHCR)

## 🤝 Contributing

We welcome contributions! If you're experiencing issues with the NPM package or Docker version, please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Excalidraw Team** - For the amazing drawing library
- **MCP Community** - For the Model Context Protocol specification
