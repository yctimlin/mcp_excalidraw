# Chat API for Excalidraw MCP Server

This document describes the chat API endpoint that allows natural language interaction with the Excalidraw canvas using LangChain.

## Overview

The chat API provides a `/api/chat` endpoint that accepts natural language requests and processes them to create or modify Excalidraw diagrams. It uses LangChain with OpenAI (when API key is available) or falls back to simple pattern matching.

## API Endpoint

**POST** `/api/chat`

### Request Body
```json
{
  "message": "Your natural language request here"
}
```

### Response
```json
{
  "success": true,
  "response": "AI response explaining what will be done",
  "timestamp": "2026-02-13T12:27:52.608Z"
}
```

## Examples

### 1. Creating a Flowchart
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Create a simple flowchart with 3 rectangles connected by arrows"}'
```

### 2. Clearing the Canvas
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Clear the canvas"}'
```

### 3. Creating from Mermaid
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Create a Mermaid diagram of a simple system"}'
```

### 4. Architecture Diagram
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Create an architecture diagram with 2 services and a database"}'
```

## How It Works

### With OpenAI API Key
When a valid `OPENAI_API_KEY` is set in the `.env` file:
1. The system uses LangChain with GPT-4o-mini model
2. It analyzes the user's request against the current canvas state
3. It generates a plan and executes appropriate actions
4. Returns detailed response about what was created

### Without OpenAI API Key (Fallback Mode)
When no valid API key is available:
1. Uses simple pattern matching for common requests
2. Provides helpful guidance on what would be done
3. Suggests setting up an API key for full AI capabilities

## Supported Actions

The chat API can trigger the following actions through the existing MCP tools:

1. **batch_create_elements** - Create multiple elements at once
2. **create_from_mermaid** - Convert Mermaid diagrams
3. **clear_canvas** - Clear all elements
4. **describe_scene** - Get canvas description
5. **set_viewport** - Control canvas viewport
6. **align_elements** - Align elements
7. **distribute_elements** - Distribute elements evenly
8. **export_to_image** - Export to PNG/SVG

## Setup

### 1. Environment Variables
Create a `.env` file with:
```env
OPENAI_API_KEY=your_openai_api_key_here
EXPRESS_SERVER_URL=http://localhost:3000
PORT=3000
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Build and Start Server
```bash
npm run build:server
npm run canvas
```

### 4. Test the API
```bash
# Test health endpoint
curl http://localhost:3000/health

# Test chat endpoint
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Create a simple diagram"}'
```

## Integration with Existing MCP Tools

The chat API leverages the existing MCP tools defined in `src/index.ts`:
- Uses the same HTTP endpoints (`/api/elements/batch`, `/api/elements/from-mermaid`, etc.)
- Maintains compatibility with WebSocket sync
- Works with the same element validation and binding logic
- Supports all existing Excalidraw element types

## Error Handling

The API includes comprehensive error handling:
- Validates input messages
- Handles missing API keys gracefully
- Provides fallback responses
- Logs errors for debugging
- Returns appropriate HTTP status codes

## Next Steps

To enhance the chat API:
1. Add support for more complex diagram types
2. Implement better action parsing from LLM responses
3. Add conversation history/memory
4. Support multi-step diagram creation
5. Integrate with more MCP tools
6. Add user authentication if needed