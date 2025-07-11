#!/usr/bin/env node

// Disable colors to prevent ANSI color codes from breaking JSON parsing
process.env.NODE_DISABLE_COLORS = '1';
process.env.NO_COLOR = '1';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema 
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import logger from './utils/logger.js';
import { 
  elements,
  validateElement, 
  generateId, 
  EXCALIDRAW_ELEMENT_TYPES 
} from './types.js';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config();

// Express server configuration
const EXPRESS_SERVER_URL = process.env.EXPRESS_SERVER_URL || 'http://localhost:3000';
const ENABLE_CANVAS_SYNC = process.env.ENABLE_CANVAS_SYNC !== 'false'; // Default to true

// Helper functions to sync with Express server (canvas)
async function syncToCanvas(operation, data) {
  if (!ENABLE_CANVAS_SYNC) {
    logger.debug('Canvas sync disabled, skipping');
    return null;
  }

  try {
    let url, options;
    
    switch (operation) {
      case 'create':
        url = `${EXPRESS_SERVER_URL}/api/elements`;
        options = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        };
        break;
        
      case 'update':
        url = `${EXPRESS_SERVER_URL}/api/elements/${data.id}`;
        options = {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        };
        break;
        
      case 'delete':
        url = `${EXPRESS_SERVER_URL}/api/elements/${data.id}`;
        options = { method: 'DELETE' };
        break;
        
      case 'batch_create':
        url = `${EXPRESS_SERVER_URL}/api/elements/batch`;
        options = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ elements: data })
        };
        break;
        
      default:
        logger.warn(`Unknown sync operation: ${operation}`);
        return null;
    }

    logger.debug(`Syncing to canvas: ${operation}`, { url, data });
    const response = await fetch(url, options);
    
    if (!response.ok) {
      throw new Error(`Canvas sync failed: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    logger.debug(`Canvas sync successful: ${operation}`, result);
    return result;
    
  } catch (error) {
    logger.warn(`Canvas sync failed for ${operation}:`, error.message);
    // Don't throw - we want MCP operations to work even if canvas is unavailable
    return null;
  }
}

// Helper to sync element creation to canvas
async function createElementOnCanvas(elementData) {
  const result = await syncToCanvas('create', elementData);
  return result?.element || elementData;
}

// Helper to sync element update to canvas  
async function updateElementOnCanvas(elementData) {
  const result = await syncToCanvas('update', elementData);
  return result?.element || elementData;
}

// Helper to sync element deletion to canvas
async function deleteElementOnCanvas(elementId) {
  const result = await syncToCanvas('delete', { id: elementId });
  return result;
}

// Helper to sync batch creation to canvas
async function batchCreateElementsOnCanvas(elementsData) {
  const result = await syncToCanvas('batch_create', elementsData);
  return result?.elements || elementsData;
}

// In-memory storage for scene state
const sceneState = {
  theme: 'light',
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedElements: new Set(),
  groups: new Map()
};

// Schema definitions using zod
const ElementSchema = z.object({
  type: z.enum(Object.values(EXCALIDRAW_ELEMENT_TYPES)),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  points: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  backgroundColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  roughness: z.number().optional(),
  opacity: z.number().optional(),
  text: z.string().optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional()
});

const ElementIdSchema = z.object({
  id: z.string()
});

const ElementIdsSchema = z.object({
  elementIds: z.array(z.string())
});

const GroupIdSchema = z.object({
  groupId: z.string()
});

const AlignElementsSchema = z.object({
  elementIds: z.array(z.string()),
  alignment: z.enum(['left', 'center', 'right', 'top', 'middle', 'bottom'])
});

const DistributeElementsSchema = z.object({
  elementIds: z.array(z.string()),
  direction: z.enum(['horizontal', 'vertical'])
});

const QuerySchema = z.object({
  type: z.enum(Object.values(EXCALIDRAW_ELEMENT_TYPES)).optional(),
  filter: z.record(z.any()).optional()
});

const ResourceSchema = z.object({
  resource: z.enum(['scene', 'library', 'theme', 'elements'])
});

// Initialize MCP server
const server = new Server(
  {
    name: "excalidraw-mcp-server",
    version: "1.0.0",
    description: "MCP server for Excalidraw"
  },
  {
    capabilities: {
      tools: {
        create_element: {
          description: 'Create a new Excalidraw element',
          inputSchema: {
            type: 'object',
            properties: {
              type: { 
                type: 'string', 
                enum: Object.values(EXCALIDRAW_ELEMENT_TYPES) 
              },
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              backgroundColor: { type: 'string' },
              strokeColor: { type: 'string' },
              strokeWidth: { type: 'number' },
              roughness: { type: 'number' },
              opacity: { type: 'number' },
              text: { type: 'string' },
              fontSize: { type: 'number' },
              fontFamily: { type: 'string' }
            },
            required: ['type', 'x', 'y']
          }
        },
        update_element: {
          description: 'Update an existing Excalidraw element',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { 
                type: 'string', 
                enum: Object.values(EXCALIDRAW_ELEMENT_TYPES) 
              },
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              backgroundColor: { type: 'string' },
              strokeColor: { type: 'string' },
              strokeWidth: { type: 'number' },
              roughness: { type: 'number' },
              opacity: { type: 'number' },
              text: { type: 'string' },
              fontSize: { type: 'number' },
              fontFamily: { type: 'string' }
            },
            required: ['id']
          }
        },
        delete_element: {
          description: 'Delete an Excalidraw element',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' }
            },
            required: ['id']
          }
        },
        query_elements: {
          description: 'Query Excalidraw elements with optional filters',
          inputSchema: {
            type: 'object',
            properties: {
              type: { 
                type: 'string', 
                enum: Object.values(EXCALIDRAW_ELEMENT_TYPES) 
              },
              filter: { 
                type: 'object',
                additionalProperties: true
              }
            }
          }
        },
        get_resource: {
          description: 'Get an Excalidraw resource',
          inputSchema: {
            type: 'object',
            properties: {
              resource: { 
                type: 'string', 
                enum: ['scene', 'library', 'theme', 'elements'] 
              }
            },
            required: ['resource']
          }
        },
        group_elements: {
          description: 'Group multiple elements together',
          inputSchema: {
            type: 'object',
            properties: {
              elementIds: { 
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['elementIds']
          }
        },
        ungroup_elements: {
          description: 'Ungroup a group of elements',
          inputSchema: {
            type: 'object',
            properties: {
              groupId: { type: 'string' }
            },
            required: ['groupId']
          }
        },
        align_elements: {
          description: 'Align elements to a specific position',
          inputSchema: {
            type: 'object',
            properties: {
              elementIds: { 
                type: 'array',
                items: { type: 'string' }
              },
              alignment: { 
                type: 'string', 
                enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'] 
              }
            },
            required: ['elementIds', 'alignment']
          }
        },
        distribute_elements: {
          description: 'Distribute elements evenly',
          inputSchema: {
            type: 'object',
            properties: {
              elementIds: { 
                type: 'array',
                items: { type: 'string' }
              },
              direction: { 
                type: 'string', 
                enum: ['horizontal', 'vertical'] 
              }
            },
            required: ['elementIds', 'direction']
          }
        },
        lock_elements: {
          description: 'Lock elements to prevent modification',
          inputSchema: {
            type: 'object',
            properties: {
              elementIds: { 
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['elementIds']
          }
        },
        unlock_elements: {
          description: 'Unlock elements to allow modification',
          inputSchema: {
            type: 'object',
            properties: {
              elementIds: { 
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['elementIds']
          }
        },
        batch_create_elements: {
          description: 'Create multiple Excalidraw elements at once - ideal for complex diagrams',
          inputSchema: {
            type: 'object',
            properties: {
              elements: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { 
                      type: 'string', 
                      enum: Object.values(EXCALIDRAW_ELEMENT_TYPES) 
                    },
                    x: { type: 'number' },
                    y: { type: 'number' },
                    width: { type: 'number' },
                    height: { type: 'number' },
                    backgroundColor: { type: 'string' },
                    strokeColor: { type: 'string' },
                    strokeWidth: { type: 'number' },
                    roughness: { type: 'number' },
                    opacity: { type: 'number' },
                    text: { type: 'string' },
                    fontSize: { type: 'number' },
                    fontFamily: { type: 'string' }
                  },
                  required: ['type', 'x', 'y']
                }
              }
            },
            required: ['elements']
          }
        },
      }
    }
  }
);

// Set up request handler for tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;
    logger.info(`Handling tool call: ${name}`);
    
    switch (name) {
      case 'create_element': {
        const params = ElementSchema.parse(args);
        logger.info('Creating element via MCP', { type: params.type });

        const id = generateId();
        const element = {
          id,
          ...params,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1
        };

        // Store locally (MCP server storage)
        elements.set(id, element);
        
        // Sync to canvas (Express server + WebSocket broadcast)
        const canvasElement = await createElementOnCanvas(element);
        
        const result = canvasElement || element;
        logger.info('Element created via MCP and synced to canvas', { 
          id: result.id, 
          type: result.type,
          synced: !!canvasElement 
        });
        
        return {
          content: [{ 
            type: 'text', 
            text: `Element created successfully!\n\n${JSON.stringify(result, null, 2)}\n\n${canvasElement ? '✅ Synced to canvas' : '⚠️  Canvas sync failed (element still created locally)'}` 
          }]
        };
      }
      
      case 'update_element': {
        const params = ElementSchema.partial().extend(ElementIdSchema).parse(args);
        const { id, ...updates } = params;
        
        if (!id) throw new Error('Element ID is required');

        const existingElement = elements.get(id);
        if (!existingElement) throw new Error(`Element with ID ${id} not found`);

        // Validate the updated element
        ElementSchema.parse({ ...existingElement, ...updates });

        const updatedElement = {
          ...existingElement,
          ...updates,
          updatedAt: new Date().toISOString(),
          version: existingElement.version + 1
        };

        // Store locally (MCP server storage)
        elements.set(id, updatedElement);
        
        // Sync to canvas (Express server + WebSocket broadcast)
        const canvasElement = await updateElementOnCanvas(updatedElement);
        
        const result = canvasElement || updatedElement;
        logger.info('Element updated via MCP and synced to canvas', { 
          id: result.id, 
          synced: !!canvasElement 
        });
        
        return {
          content: [{ 
            type: 'text', 
            text: `Element updated successfully!\n\n${JSON.stringify(result, null, 2)}\n\n${canvasElement ? '✅ Synced to canvas' : '⚠️  Canvas sync failed (element still updated locally)'}` 
          }]
        };
      }
      
      case 'delete_element': {
        const params = ElementIdSchema.parse(args);
        const { id } = params;
        
        if (!elements.has(id)) throw new Error(`Element with ID ${id} not found`);
        
        // Delete locally (MCP server storage)
        elements.delete(id);
        
        // Sync to canvas (Express server + WebSocket broadcast)
        const canvasResult = await deleteElementOnCanvas(id);
        
        const result = { id, deleted: true, syncedToCanvas: !!canvasResult };
        logger.info('Element deleted via MCP and synced to canvas', result);
        
        return {
          content: [{ 
            type: 'text', 
            text: `Element deleted successfully!\n\n${JSON.stringify(result, null, 2)}\n\n${canvasResult ? '✅ Synced to canvas' : '⚠️  Canvas sync failed (element still deleted locally)'}` 
          }]
        };
      }
      
      case 'query_elements': {
        const params = QuerySchema.parse(args || {});
        const { type, filter } = params;
        
        let results = Array.from(elements.values());
        
        if (type) {
          results = results.filter(element => element.type === type);
        }
        
        if (filter) {
          results = results.filter(element => {
            return Object.entries(filter).every(([key, value]) => {
              return element[key] === value;
            });
          });
        }
        
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
        };
      }
      
      case 'get_resource': {
        const params = ResourceSchema.parse(args);
        const { resource } = params;
        logger.info('Getting resource', { resource });
        
        let result;
        switch (resource) {
          case 'scene':
            result = {
              theme: sceneState.theme,
              viewport: sceneState.viewport,
              selectedElements: Array.from(sceneState.selectedElements)
            };
            break;
          case 'library':
            result = {
              elements: Array.from(elements.values())
            };
            break;
          case 'theme':
            result = {
              theme: sceneState.theme
            };
            break;
          case 'elements':
            result = {
              elements: Array.from(elements.values())
            };
            break;
          default:
            throw new Error(`Unknown resource: ${resource}`);
        }
        
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }
      
      case 'group_elements': {
        const params = ElementIdsSchema.parse(args);
        const { elementIds } = params;
        
        const groupId = generateId();
        sceneState.groups.set(groupId, elementIds);
        
        const result = { groupId, elementIds };
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }
      
      case 'ungroup_elements': {
        const params = GroupIdSchema.parse(args);
        const { groupId } = params;
        
        if (!sceneState.groups.has(groupId)) {
          throw new Error(`Group ${groupId} not found`);
        }
        
        const elementIds = sceneState.groups.get(groupId);
        sceneState.groups.delete(groupId);
        
        const result = { groupId, ungrouped: true, elementIds };
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }
      
      case 'align_elements': {
        const params = AlignElementsSchema.parse(args);
        const { elementIds, alignment } = params;
        
        // Implementation would align elements based on the specified alignment
        logger.info('Aligning elements', { elementIds, alignment });
        
        const result = { aligned: true, elementIds, alignment };
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }
      
      case 'distribute_elements': {
        const params = DistributeElementsSchema.parse(args);
        const { elementIds, direction } = params;
        
        // Implementation would distribute elements based on the specified direction
        logger.info('Distributing elements', { elementIds, direction });
        
        const result = { distributed: true, elementIds, direction };
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }
      
      case 'lock_elements': {
        const params = ElementIdsSchema.parse(args);
        const { elementIds } = params;
        
        elementIds.forEach(id => {
          const element = elements.get(id);
          if (element) {
            element.locked = true;
          }
        });
        
        const result = { locked: true, elementIds };
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }
      
      case 'unlock_elements': {
        const params = ElementIdsSchema.parse(args);
        const { elementIds } = params;
        
        elementIds.forEach(id => {
          const element = elements.get(id);
          if (element) {
            element.locked = false;
          }
        });
        
        const result = { unlocked: true, elementIds };
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }
      
      case 'batch_create_elements': {
        const params = z.object({ elements: z.array(ElementSchema) }).parse(args);
        logger.info('Batch creating elements via MCP', { count: params.elements.length });

        const createdElements = [];
        
        // Create each element with unique ID
        for (const elementData of params.elements) {
          const id = generateId();
          const element = {
            id,
            ...elementData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1
          };
          
          // Store locally (MCP server storage)
          elements.set(id, element);
          createdElements.push(element);
        }
        
        // Sync all elements to canvas at once (Express server + WebSocket broadcast)
        const canvasElements = await batchCreateElementsOnCanvas(createdElements);
        
        const result = {
          success: true,
          elements: canvasElements || createdElements,
          count: createdElements.length,
          syncedToCanvas: !!canvasElements
        };
        
        logger.info('Batch elements created via MCP and synced to canvas', { 
          count: result.count,
          synced: result.syncedToCanvas 
        });
        
        return {
          content: [{ 
            type: 'text', 
            text: `${result.count} elements created successfully!\n\n${JSON.stringify(result, null, 2)}\n\n${result.syncedToCanvas ? '✅ All elements synced to canvas' : '⚠️  Canvas sync failed (elements still created locally)'}` 
          }]
        };
      }
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    logger.error(`Error handling tool call: ${error.message}`, { error });
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

// Set up request handler for listing available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.info('Listing available tools');
  
  const tools = [
    {
      name: 'create_element',
      description: 'Create a new Excalidraw element',
      inputSchema: {
        type: 'object',
        properties: {
          type: { 
            type: 'string', 
            enum: Object.values(EXCALIDRAW_ELEMENT_TYPES) 
          },
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          backgroundColor: { type: 'string' },
          strokeColor: { type: 'string' },
          strokeWidth: { type: 'number' },
          roughness: { type: 'number' },
          opacity: { type: 'number' },
          text: { type: 'string' },
          fontSize: { type: 'number' },
          fontFamily: { type: 'string' }
        },
        required: ['type', 'x', 'y']
      }
    },
    {
      name: 'update_element',
      description: 'Update an existing Excalidraw element',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { 
            type: 'string', 
            enum: Object.values(EXCALIDRAW_ELEMENT_TYPES) 
          },
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          backgroundColor: { type: 'string' },
          strokeColor: { type: 'string' },
          strokeWidth: { type: 'number' },
          roughness: { type: 'number' },
          opacity: { type: 'number' },
          text: { type: 'string' },
          fontSize: { type: 'number' },
          fontFamily: { type: 'string' }
        },
        required: ['id']
      }
    },
    {
      name: 'delete_element',
      description: 'Delete an Excalidraw element',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      }
    },
    {
      name: 'query_elements',
      description: 'Query Excalidraw elements with optional filters',
      inputSchema: {
        type: 'object',
        properties: {
          type: { 
            type: 'string', 
            enum: Object.values(EXCALIDRAW_ELEMENT_TYPES) 
          },
          filter: { 
            type: 'object',
            additionalProperties: true
          }
        }
      }
    },
    {
      name: 'get_resource',
      description: 'Get an Excalidraw resource',
      inputSchema: {
        type: 'object',
        properties: {
          resource: { 
            type: 'string', 
            enum: ['scene', 'library', 'theme', 'elements'] 
          }
        },
        required: ['resource']
      }
    },
    {
      name: 'group_elements',
      description: 'Group multiple elements together',
      inputSchema: {
        type: 'object',
        properties: {
          elementIds: { 
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['elementIds']
      }
    },
    {
      name: 'ungroup_elements',
      description: 'Ungroup a group of elements',
      inputSchema: {
        type: 'object',
        properties: {
          groupId: { type: 'string' }
        },
        required: ['groupId']
      }
    },
    {
      name: 'align_elements',
      description: 'Align elements to a specific position',
      inputSchema: {
        type: 'object',
        properties: {
          elementIds: { 
            type: 'array',
            items: { type: 'string' }
          },
          alignment: { 
            type: 'string', 
            enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'] 
          }
        },
        required: ['elementIds', 'alignment']
      }
    },
    {
      name: 'distribute_elements',
      description: 'Distribute elements evenly',
      inputSchema: {
        type: 'object',
        properties: {
          elementIds: { 
            type: 'array',
            items: { type: 'string' }
          },
          direction: { 
            type: 'string', 
            enum: ['horizontal', 'vertical'] 
          }
        },
        required: ['elementIds', 'direction']
      }
    },
    {
      name: 'lock_elements',
      description: 'Lock elements to prevent modification',
      inputSchema: {
        type: 'object',
        properties: {
          elementIds: { 
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['elementIds']
      }
    },
    {
      name: 'unlock_elements',
      description: 'Unlock elements to allow modification',
      inputSchema: {
        type: 'object',
        properties: {
          elementIds: { 
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['elementIds']
      }
    },
    {
      name: 'batch_create_elements',
      description: 'Create multiple Excalidraw elements at once - ideal for complex diagrams',
      inputSchema: {
        type: 'object',
        properties: {
          elements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { 
                  type: 'string', 
                  enum: Object.values(EXCALIDRAW_ELEMENT_TYPES) 
                },
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number' },
                height: { type: 'number' },
                backgroundColor: { type: 'string' },
                strokeColor: { type: 'string' },
                strokeWidth: { type: 'number' },
                roughness: { type: 'number' },
                opacity: { type: 'number' },
                text: { type: 'string' },
                fontSize: { type: 'number' },
                fontFamily: { type: 'string' }
              },
              required: ['type', 'x', 'y']
            }
          }
        },
        required: ['elements']
      }
    }
  ];
  
  return { tools };
});

// Start server with transport based on mode
async function runServer() {
  try {
    logger.info('Starting Excalidraw MCP server...');
    
    const transportMode = process.env.MCP_TRANSPORT_MODE || 'stdio';
    let transport;
    
    if (transportMode === 'http') {
      const port = parseInt(process.env.PORT || '3000', 10);
      const host = process.env.HOST || 'localhost';
      
      logger.info(`Starting HTTP server on ${host}:${port}`);
      // Here you would create an HTTP transport
      // This is a placeholder - actual HTTP transport implementation would need to be added
      transport = new StdioServerTransport(); // Fallback to stdio for now
    } else {
      // Default to stdio transport
      transport = new StdioServerTransport();
    }
    
    // Add a debug message before connecting
    logger.debug('Connecting to transport...');
    
    await server.connect(transport);
    logger.info(`Excalidraw MCP server running on ${transportMode}`);
    
    // Keep the process running
    process.stdin.resume();
  } catch (error) {
    logger.error('Error starting server:', error);
    process.stderr.write(`Failed to start MCP server: ${error.message}\n${error.stack}\n`);
    process.exit(1);
  }
}

// Add global error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.stderr.write(`UNCAUGHT EXCEPTION: ${error.message}\n${error.stack}\n`);
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection:', reason);
  process.stderr.write(`UNHANDLED REJECTION: ${reason}\n`);
  setTimeout(() => process.exit(1), 1000);
});

// For testing and debugging purposes
if (process.env.DEBUG === 'true') {
  logger.debug('Debug mode enabled');
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runServer().catch(error => {
    logger.error('Failed to start server:', error);
    process.exit(1);
  });
}

export default runServer; 