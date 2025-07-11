# MCP Excalidraw Server: Advanced Live Visual Diagramming with AI Integration

A comprehensive system that combines **Excalidraw's powerful drawing capabilities** with **Model Context Protocol (MCP)** integration, enabling AI agents to create and manipulate diagrams in real-time on a live canvas.

> **🚀 NEW: Now available as `mcp-excalidraw-server` on npm!** Install with `npm install -g mcp-excalidraw-server` or run directly with `npx mcp-excalidraw-server`.

## 🚀 What This System Does

- **🎨 Live Canvas**: Real-time Excalidraw canvas accessible via web browser
- **🤖 AI Integration**: MCP server allows AI agents (like Claude) to create visual diagrams
- **⚡ Real-time Sync**: Elements created via MCP API appear instantly on the canvas
- **🔄 WebSocket Updates**: Live synchronization across multiple connected clients
- **🏗️ Production Ready**: Clean, minimal UI suitable for end users

## 🏛️ Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   AI Agent      │───▶│   MCP Server     │───▶│  Canvas Server  │
│   (Claude)      │    │  (src/index.js) │    │ (src/server.js) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
                                                         ▼
                                               ┌─────────────────┐
                                               │  Frontend       │
                                               │  (React + WS)   │
                                               └─────────────────┘
```

## 🌟 Key Features

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
- Express.js backend with REST API + WebSocket
- React frontend with official Excalidraw package
- Dual-path element loading for reliability
- Auto-reconnection and error handling

## 📦 Installation & Setup

### **Prerequisites**
- Node.js 16+ 
- npm or yarn

### **Option 1: NPM Installation (Recommended)**

#### **Global Installation**
```bash
# Install globally
npm install -g mcp-excalidraw-server

# Run the server
mcp-excalidraw-server
```

#### **Run Without Installation**
```bash
# Run directly with npx (no installation needed)
npx mcp-excalidraw-server
```

#### **Local Project Installation**
```bash
# Install in your project
npm install mcp-excalidraw-server

# Run from node_modules
npx mcp-excalidraw-server
```

### **Option 2: Clone from Source**
```bash
git clone https://github.com/yctimlin/mcp_excalidraw.git
cd mcp_excalidraw
npm install
```

### **2. Build the Frontend**
```bash
npm run build
```

### **3. Start the System**

#### **Option A: Production Mode**
```bash
# Start canvas server (serves frontend + API)
npm run canvas
```

#### **Option B: Development Mode**
```bash
# Start both canvas server and Vite dev server
npm run dev
```

### **4. Access the Canvas**
Open your browser and navigate to:
```
http://localhost:3000
```

## 🔧 Available Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start MCP server (`src/index.js`) |
| `npm run canvas` | Start canvas server (`src/server.js`) |
| `npm run build` | Build frontend for production |
| `npm run dev` | Start canvas + Vite dev server |
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

## 🔌 Integration with Claude Desktop

### **Using NPM Package (Recommended)**

Add this configuration to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "npx",
      "args": ["-y", "mcp-excalidraw-server"]
    }
  }
}
```

### **Using Global Installation**

If you installed globally with `npm install -g mcp-excalidraw-server`:

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "mcp-excalidraw-server",
      "args": []
    }
  }
}
```

### **Using Source Installation**

If you cloned from source:

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": ["/path/to/mcp_excalidraw/src/index.js"]
    }
  }
}
```

**Important**: Replace `/path/to/mcp_excalidraw` with the actual absolute path to your installation.

## 🔧 Integration with Other Tools

### **Cursor IDE**

Add to your `claude_desktop_config.json` or MCP settings:

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "npx",
      "args": ["-y", "mcp-excalidraw-server"]
    }
  }
}
```

### **VS Code MCP Extension**

For VS Code MCP extension, add to your settings:

```json
{
  "mcp": {
    "servers": {
      "excalidraw": {
        "command": "npx",
        "args": ["-y", "mcp-excalidraw-server"]
      }
    }
  }
}
```

### **Command Line Usage**

```bash
# Run directly with npx (no installation needed)
npx mcp-excalidraw-server

# Run with global installation
mcp-excalidraw-server

# Run with custom canvas server URL
EXPRESS_SERVER_URL=http://localhost:8080 npx mcp-excalidraw-server

# Run with debug logging
DEBUG=true npx mcp-excalidraw-server
```

## 🛠️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EXPRESS_SERVER_URL` | `http://localhost:3000` | Canvas server URL for MCP sync |
| `ENABLE_CANVAS_SYNC` | `true` | Enable/disable canvas synchronization |
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
- **React + Vite**: Modern build system
- **Official Excalidraw**: `@excalidraw/excalidraw` package
- **WebSocket Client**: Real-time element sync
- **Clean UI**: Production-ready interface

### **Canvas Server** (`src/server.js`)
- **Express.js**: REST API + static file serving
- **WebSocket**: Real-time client communication  
- **Element Storage**: In-memory with persistence options
- **CORS**: Cross-origin support

### **MCP Server** (`src/index.js`)
- **MCP Protocol**: Standard Model Context Protocol
- **Canvas Sync**: HTTP requests to canvas server
- **Element Management**: Full CRUD operations
- **Batch Support**: Complex diagram creation

## 🐛 Troubleshooting

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

## 📋 Project Structure

```
mcp_excalidraw/
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Main React component
│   │   └── main.jsx         # React entry point
│   └── index.html           # HTML template
├── src/
│   ├── index.js            # MCP server
│   ├── server.js           # Canvas server (Express + WebSocket)
│   ├── types.js            # Shared types and utilities
│   └── utils/
│       └── logger.js       # Logging utility
├── dist/                   # Built frontend (generated)
├── vite.config.js         # Vite build configuration
├── package.json           # Dependencies and scripts
└── README.md              # This file
```

## 🤝 Contributing

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