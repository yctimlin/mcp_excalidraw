# MCP Excalidraw Server: Advanced Live Visual Diagramming with AI Integration

A comprehensive **TypeScript-based** system that combines **Excalidraw's powerful drawing capabilities** with **Model Context Protocol (MCP)** integration, enabling AI agents to create and manipulate diagrams in real-time on a live canvas.

## 🚦 Current Status & Version Information

> **📋 Choose Your Installation Method**

| Version | Status | Recommended For |
|---------|--------|----------------|
| **Local Development** | ✅ **FULLY TESTED** | **🎯 RECOMMENDED** |
| **NPM Published** | 🔧 **DEBUGGING IN PROGRESS** | Development testing |
| **Docker Version** | 🔧 **UNDER DEVELOPMENT** | Future deployment |

### **Current Recommendation: Local Development**

For the most stable experience, we recommend using the local development setup. We're actively working on improving the NPM package and Docker deployment options.

### **Development Notes**
- **NPM Package**: Currently debugging MCP tool registration issues
- **Docker Version**: Improving canvas synchronization reliability
- **Local Version**: ✅ All features fully functional

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

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   AI Agent      │───▶│   MCP Server     │───▶│  Canvas Server  │
│   (Claude)      │    │  (src/index.js)  │    │ (src/server.js) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
                                                         ▼
                                               ┌─────────────────┐
                                               │  Frontend       │
                                               │  (React + WS)   │
                                               └─────────────────┘
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

### **✅ Recommended: Local Development Setup**

> **Most stable and feature-complete option**

#### **1. Clone the Repository**
```bash
git clone https://github.com/yctimlin/mcp_excalidraw.git
cd mcp_excalidraw
npm install
```

#### **2. Build the Frontend**
```bash
npm run build
```

#### **3. Start the System**

##### **Option A: Production Mode (Recommended)**
```bash
# Start canvas server (serves frontend + API)
npm run canvas
```

##### **Option B: Development Mode**
```bash
# Start both canvas server and Vite dev server
npm run dev
```

#### **4. Access the Canvas**
Open your browser and navigate to:
```
http://localhost:3000
```

### **🔧 Alternative Installation Methods (In Development)**

#### **NPM Package (Beta)**
```bash
# Currently debugging tool registration - feedback welcome!
npm install -g mcp-excalidraw-server
npx mcp-excalidraw-server
```

#### **Docker Version (Coming Soon)**
```bash
# Canvas sync improvements in progress
docker run -p 3000:3000 mcp-excalidraw-server
```

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

## 🔌 Integration with Claude Desktop & Claude Code

### **Prerequisites**
Before integrating with Claude, ensure the **canvas server is running** (if you want visualization):

```bash
# Option 1: Using local npm
npm run canvas

# Option 2: Using Docker
docker-compose up canvas -d

# Option 3: Using Docker directly
docker run -d -p 3000:3000 --name mcp-excalidraw-canvas mcp-excalidraw-canvas:latest
```

Canvas will be available at http://localhost:3000

---

### **For Claude Desktop**

Add to your `claude_desktop_config.json`:

#### **✅ Option 1: Local Node (Recommended)**
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
*Replace `/absolute/path/to/mcp_excalidraw` with your actual path.*

#### **Option 2: Docker**
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
        "mcp-excalidraw:latest"
      ]
    }
  }
}
```

#### **Option 3: Docker from GHCR (Available Soon)**
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

---

### **For Claude Code**

Create or edit `.mcp.json` in your project root:

#### **✅ Option 1: Local Node (Recommended)**
```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": ["/home/ec2-user/workspace/yuanching/mcp_excalidraw/dist/index.js"],
      "env": {
        "EXPRESS_SERVER_URL": "http://localhost:3000",
        "ENABLE_CANVAS_SYNC": "true"
      }
    }
  }
}
```
*Replace with your actual absolute path.*

#### **Option 2: Docker**
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
        "mcp-excalidraw:latest"
      ]
    }
  }
}
```

#### **Using CLI (Alternative)**
```bash
# For project-scoped (recommended)
claude mcp add --scope project --transport stdio excalidraw \
  -- docker run -i --rm --network host \
  -e EXPRESS_SERVER_URL=http://localhost:3000 \
  -e ENABLE_CANVAS_SYNC=true \
  mcp-excalidraw:latest

# For user-scoped (available across all projects)
claude mcp add --scope user --transport stdio excalidraw \
  -- docker run -i --rm --network host \
  -e EXPRESS_SERVER_URL=http://localhost:3000 \
  -e ENABLE_CANVAS_SYNC=true \
  mcp-excalidraw:latest
```

---

### **For Cursor IDE**

Add to your `.cursor/mcp.json`:

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

---

### **Important Notes**

1. **Canvas is optional**: The MCP server works without the canvas (API-only mode)
2. **Network mode**: Docker requires `--network host` to access localhost canvas
3. **Interactive mode**: Docker requires `-i` flag for MCP stdin/stdout protocol
4. **Port 3000**: Ensure canvas server is running on port 3000 before using MCP tools

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

### **NPM Package Issues**
- **Symptoms**: MCP tools not registering properly
- **Temporary Solution**: Use local development setup
- **Status**: Actively debugging - updates coming soon

### **Docker Version Notes**
- **Symptoms**: Elements may not sync to canvas immediately
- **Temporary Solution**: Use local development setup
- **Status**: Improving synchronization reliability

### **Canvas Not Loading**
- Ensure `npm run build` completed successfully
- Check that `dist/index.html` exists
- Verify canvas server is running on port 3000

### **Elements Not Syncing**
- Confirm MCP server is running (`npm start`)
- Check `ENABLE_CANVAS_SYNC=true` in environment
- Verify canvas server is accessible at `EXPRESS_SERVER_URL`

### **WebSocket Connection Issues**  
- Check browser console for WebSocket errors
- Ensure no firewall blocking WebSocket connections
- Try refreshing the browser page

### **Build Errors**
- Delete `node_modules` and run `npm install`
- Check Node.js version (requires 16+)
- Ensure all dependencies are installed
- Run `npm run type-check` to identify TypeScript issues
- Verify `dist/` directory is created after `npm run build:server`

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
- **NPM Package**: Resolving MCP tool registration issues
- **Docker Deployment**: Improving canvas synchronization
- **Enhanced Features**: Additional MCP tools and capabilities
- **Performance Optimization**: Real-time sync improvements
- **Advanced TypeScript Features**: Stricter type checking and advanced type utilities

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
