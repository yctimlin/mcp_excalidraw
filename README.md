# MCP Excalidraw Server: Advanced Live Visual Diagramming with AI Integration

A comprehensive system that combines **Excalidraw's powerful drawing capabilities** with **Model Context Protocol (MCP)** integration, enabling AI agents to create and manipulate diagrams in real-time on a live canvas.

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

### **✅ Recommended: Using Local Installation**

For the **local development version** (most stable), add this configuration to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": ["/absolute/path/to/mcp_excalidraw/src/index.js"]
    }
  }
}
```

**Important**: Replace `/absolute/path/to/mcp_excalidraw` with the actual absolute path to your cloned repository.

### **🔧 Alternative Configurations (Beta)**

#### **NPM Package (Beta Testing)**
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
*Currently debugging tool registration - let us know if you encounter issues!*

#### **Docker Version (Coming Soon)**
```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "mcp-excalidraw-server"]
    }
  }
}
```
*Canvas sync improvements in progress.*

## 🔧 Integration with Other Tools

### **Cursor IDE**

Add to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": ["/absolute/path/to/mcp_excalidraw/src/index.js"]
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
        "command": "node",
        "args": ["/absolute/path/to/mcp_excalidraw/src/index.js"]
      }
    }
  }
}
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

## 🔮 Development Roadmap

- **NPM Package**: Resolving MCP tool registration issues
- **Docker Deployment**: Improving canvas synchronization
- **Enhanced Features**: Additional MCP tools and capabilities
- **Performance Optimization**: Real-time sync improvements

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
