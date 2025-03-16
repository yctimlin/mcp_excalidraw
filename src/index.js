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

// Load environment variables
dotenv.config();

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
        logger.info('Creating element', { type: params.type });

        const id = generateId();
        const element = {
          id,
          ...params,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1
        };

        elements.set(id, element);
        
        return {
          content: [{ type: 'text', text: JSON.stringify(element, null, 2) }]
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

        elements.set(id, updatedElement);
        
        return {
          content: [{ type: 'text', text: JSON.stringify(updatedElement, null, 2) }]
        };
      }
      
      case 'delete_element': {
        const params = ElementIdSchema.parse(args);
        const { id } = params;
        
        if (!elements.has(id)) throw new Error(`Element with ID ${id} not found`);
        
        elements.delete(id);
        
        return {
          content: [{ type: 'text', text: JSON.stringify({ id, deleted: true }, null, 2) }]
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
    }
  ];
  
  return { tools };
});

// Start server with STDIO transport
async function runServer() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('Excalidraw MCP server running on stdio');
  } catch (error) {
    logger.error('Error starting server:', error);
    process.exit(1);
  }
}

runServer();

// For testing and debugging purposes
if (process.env.DEBUG === 'true') {
  logger.debug('Debug mode enabled');
}

export default server; 