# Excalidraw MCP Server: Powerful Drawing API for LLM Integration

A comprehensive Model Context Protocol (MCP) server that enables seamless interaction with Excalidraw diagrams and drawings. This server provides LLMs (Large Language Models) with the ability to create, modify, query, and manipulate Excalidraw drawings through a structured, developer-friendly API.

## Features

- **Full Excalidraw Element Control**: Create, update, delete, and query any Excalidraw element
- **Advanced Element Manipulation**: Group, align, distribute, lock, and unlock elements
- **Resource Management**: Access and modify scene information, libraries, themes, and elements
- **Easy Integration**: Works with Claude Desktop and other LLM platforms
- **Docker Support**: Simple deployment with containerization options

## API Tools Reference

### Element Creation and Modification

* **create_element**
  * Create a new Excalidraw element (rectangle, ellipse, diamond, etc.)
  * Required inputs: `type`, `x`, `y` coordinates
  * Optional inputs: dimensions, colors, styling properties

* **update_element**
  * Update an existing Excalidraw element by ID
  * Required input: `id` of the element to update
  * Optional inputs: any element property to modify

* **delete_element**
  * Delete an Excalidraw element
  * Required input: `id` of the element to delete

* **query_elements**
  * Query elements with optional filtering
  * Optional inputs: `type` to filter by element type, `filter` object with key-value pairs

### Resource Management

* **get_resource**
  * Get a specific resource like scene information or all elements
  * Required input: `resource` type (scene, library, theme, elements)

### Element Organization

* **group_elements**
  * Group multiple elements together
  * Required input: `elementIds` array of element IDs to group

* **ungroup_elements**
  * Ungroup a group of elements
  * Required input: `groupId` of the group to ungroup

* **align_elements**
  * Align multiple elements based on specified alignment
  * Required inputs: `elementIds` array and `alignment` (left, center, right, top, middle, bottom)

* **distribute_elements**
  * Distribute elements evenly across space
  * Required inputs: `elementIds` array and `direction` (horizontal or vertical)

* **lock_elements**
  * Lock elements to prevent modification
  * Required input: `elementIds` array of elements to lock

* **unlock_elements**
  * Unlock elements to allow modification
  * Required input: `elementIds` array of elements to unlock

## Integration with Claude Desktop

To use this server with the Claude Desktop application, add the following configuration to the "mcpServers" section of your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": ["src/index.js"],
      "env": {
        "LOG_LEVEL": "info",
        "DEBUG": "false"
      }
    }
  }
}
```

## Integration with Cursor

To use this server with Cursor, create a `.cursor/mcp.json` file in your workspace with the following configuration:

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": [
        "/path/to/your/directory/mcp_excalidraw/src/index.js"
      ],
      "env": {
        "LOG_LEVEL": "info",
        "DEBUG": "false"
      }
    }
  }
}
```

Make sure to:
1. Replace `/path/to/your/directory` with the actual absolute path to your mcp_excalidraw installation
2. Create the `.cursor` directory if it doesn't exist
3. Ensure the path to `index.js` is correct and the file exists

### Docker Integration

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "mcp/excalidraw"],
      "env": {
        "LOG_LEVEL": "info",
        "DEBUG": "false"
      }
    }
  }
}
```

## Installation Guide

### NPM Installation

```bash
# Install dependencies
npm install

# Start the server
npm start
```

### Docker Installation

```bash
# Build the Docker image
docker build -t mcp/excalidraw .

# Run the container
docker run -i --rm mcp/excalidraw
```

## Configuration Options

The server can be configured using the following environment variables:

- `LOG_LEVEL` - Set the logging level (default: "info")
- `DEBUG` - Enable debug mode (default: "false")
- `DEFAULT_THEME` - Set the default theme (default: "light")

## Usage Examples

Here are some practical examples of how to use the Excalidraw MCP server:

### Creating a Rectangle Element

```json
{
  "type": "rectangle",
  "x": 100,
  "y": 100,
  "width": 200,
  "height": 100,
  "backgroundColor": "#ffffff",
  "strokeColor": "#000000",
  "strokeWidth": 2,
  "roughness": 1
}
```

### Querying Specific Elements

```json
{
  "type": "rectangle",
  "filter": {
    "strokeColor": "#000000"
  }
}
```

### Grouping Multiple Elements

```json
{
  "elementIds": ["elem1", "elem2", "elem3"]
}
```

## License

This Excalidraw MCP server is licensed under the MIT License. You are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository. 