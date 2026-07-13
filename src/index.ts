#!/usr/bin/env node

// Disable colors to prevent ANSI color codes from breaking JSON parsing
process.env.NODE_DISABLE_COLORS = '1';
process.env.NO_COLOR = '1';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolRequest,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import fs from 'fs';
import logger from './utils/logger.js';
import { isMainModule } from './core/entry.js';
import { packageVersion } from './core/version.js';
import {
  EXCALIDRAW_ELEMENT_TYPES,
  ServerElement,
  ExcalidrawElementType
} from './types.js';
import { EXPRESS_SERVER_URL, ENABLE_CANVAS_SYNC, EXCALIDRAW_NO_AUTOSTART } from './core/config.js';
import { ensureCanvasRunning } from './core/spawn.js';
import {
  updateElementOnCanvas,
  deleteElementOnCanvas,
  getElementFromCanvas,
  createElementOnCanvas,
  batchCreateElementsOnCanvas,
  getElements,
  searchElements,
  clearCanvas,
  exportImage,
  setViewport,
  saveSnapshot,
  getSnapshot,
  sendMermaid,
  ApiResponse
} from './core/canvas-client.js';
import { sanitizeFilePath, prepareElement, prepareElementUpdate } from './core/normalize.js';
import {
  alignElements,
  distributeElements,
  setElementsLocked,
  groupElements,
  ungroupElements,
  duplicateElements
} from './core/geometry.js';
import { buildSceneFile, importScene } from './core/scene-io.js';
import { wrapSceneAsObsidianMd } from './core/obsidian-md.js';
import { describeScene } from './core/describe.js';
import { exportToExcalidrawUrl } from './core/share-url.js';
import { DIAGRAM_DESIGN_GUIDE } from './core/design-guide.js';

// In-memory storage for scene state
interface SceneState {
  theme: string;
  viewport: { x: number; y: number; zoom: number };
  selectedElements: Set<string>;
  groups: Map<string, string[]>;
}

const sceneState: SceneState = {
  theme: 'light',
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedElements: new Set(),
  groups: new Map()
};

let canvasEnsurePromise: Promise<unknown> | null = null;

async function ensureCanvasReadyForMcpTool(): Promise<void> {
  if (!canvasEnsurePromise) {
    canvasEnsurePromise = ensureCanvasRunning().finally(() => {
      canvasEnsurePromise = null;
    });
  }
  await canvasEnsurePromise;
}

function toolNeedsCanvasBeforeDispatch(name: string): boolean {
  return name !== 'read_diagram_guide' && name !== 'get_resource';
}

// Points schema: accept both {x, y} objects and [x, y] tuples
const PointObjectSchema = z.object({ x: z.number(), y: z.number() });
const PointTupleSchema = z.tuple([z.number(), z.number()]);
const PointSchema = z.union([PointObjectSchema, PointTupleSchema]);

// Schema definitions using zod
const ElementSchema = z.object({
  id: z.string().optional(),
  type: z.enum(Object.values(EXCALIDRAW_ELEMENT_TYPES) as [ExcalidrawElementType, ...ExcalidrawElementType[]]),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  points: z.array(PointSchema).optional(),
  backgroundColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  roughness: z.number().optional(),
  opacity: z.number().optional(),
  text: z.string().optional(),
  fontSize: z.number().optional(),
  fontFamily: z.union([z.string(), z.number()]).optional(),
  groupIds: z.array(z.string()).optional(),
  locked: z.boolean().optional(),
  strokeStyle: z.string().optional(),
  roundness: z.object({ type: z.number(), value: z.number().optional() }).nullable().optional(),
  fillStyle: z.string().optional(),
  elbowed: z.boolean().optional(),
  startElementId: z.string().optional(),
  endElementId: z.string().optional(),
  endArrowhead: z.string().optional(),
  startArrowhead: z.string().optional(),
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
  type: z.enum(Object.values(EXCALIDRAW_ELEMENT_TYPES) as [ExcalidrawElementType, ...ExcalidrawElementType[]]).optional(),
  filter: z.record(z.any()).optional(),
  bbox: z.object({
    x_min: z.number().optional(),
    x_max: z.number().optional(),
    y_min: z.number().optional(),
    y_max: z.number().optional()
  }).optional()
});

const ResourceSchema = z.object({
  resource: z.enum(['scene', 'library', 'theme', 'elements'])
});

// Tool definitions
const tools: Tool[] = [
  {
    name: 'create_element',
    description: 'Create a new Excalidraw element. For arrows, use startElementId/endElementId to bind to shapes (auto-routes to edges).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Custom element ID (optional, auto-generated if omitted). Use with startElementId/endElementId in batch_create_elements.' },
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
        strokeStyle: { type: 'string', description: 'Stroke style: solid, dashed, dotted' },
        roughness: { type: 'number' },
        opacity: { type: 'number' },
        text: { type: 'string' },
        fontSize: { type: 'number' },
        fontFamily: { type: ['string', 'number'], description: 'Font family: virgil/hand/handwritten (1), helvetica/sans/sans-serif (2), cascadia/mono/monospace (3), excalifont (5), nunito (6), lilita/lilita one (7), comic shanns/comic (8), or numeric ID' },
        startElementId: { type: 'string', description: 'For arrows: ID of the element to bind the arrow start to. Arrow auto-routes to element edge.' },
        endElementId: { type: 'string', description: 'For arrows: ID of the element to bind the arrow end to. Arrow auto-routes to element edge.' },
        endArrowhead: { type: 'string', description: 'Arrowhead style at end: arrow, bar, dot, triangle, or null' },
        startArrowhead: { type: 'string', description: 'Arrowhead style at start: arrow, bar, dot, triangle, or null' }
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
        strokeStyle: { type: 'string' },
        roughness: { type: 'number' },
        opacity: { type: 'number' },
        text: { type: 'string' },
        fontSize: { type: 'number' },
        fontFamily: { type: ['string', 'number'], description: 'Font family: virgil/hand/handwritten (1), helvetica/sans/sans-serif (2), cascadia/mono/monospace (3), excalifont (5), nunito (6), lilita/lilita one (7), comic shanns/comic (8), or numeric ID' }
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
        },
        bbox: {
          type: 'object',
          description: 'Bounding box filter — only return elements whose origin (x, y) falls within the given coordinate range',
          properties: {
            x_min: { type: 'number' },
            x_max: { type: 'number' },
            y_min: { type: 'number' },
            y_max: { type: 'number' }
          }
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
    name: 'create_from_mermaid',
    description: 'Convert a Mermaid diagram to Excalidraw elements and render them on the canvas',
    inputSchema: {
      type: 'object',
      properties: {
        mermaidDiagram: {
          type: 'string',
          description: 'The Mermaid diagram definition (e.g., "graph TD; A-->B; B-->C;")'
        },
        config: {
          type: 'object',
          description: 'Optional Mermaid configuration',
          properties: {
            startOnLoad: { type: 'boolean' },
            flowchart: {
              type: 'object',
              properties: {
                curve: { type: 'string', enum: ['linear', 'basis'] }
              }
            },
            themeVariables: {
              type: 'object',
              properties: {
                fontSize: { type: 'string' }
              }
            },
            maxEdges: { type: 'number' },
            maxTextSize: { type: 'number' }
          }
        }
      },
      required: ['mermaidDiagram']
    }
  },
  {
    name: 'batch_create_elements',
    description: 'Create multiple Excalidraw elements at once. For arrows, use startElementId/endElementId to bind arrows to shapes — Excalidraw auto-routes to element edges. Assign custom id to shapes so arrows can reference them.',
    inputSchema: {
      type: 'object',
      properties: {
        elements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Custom element ID. Arrows can reference this via startElementId/endElementId.' },
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
              strokeStyle: { type: 'string', description: 'Stroke style: solid, dashed, dotted' },
              roughness: { type: 'number' },
              opacity: { type: 'number' },
              text: { type: 'string' },
              fontSize: { type: 'number' },
              fontFamily: { type: ['string', 'number'], description: 'Font family: virgil/hand/handwritten (1), helvetica/sans/sans-serif (2), cascadia/mono/monospace (3), excalifont (5), nunito (6), lilita/lilita one (7), comic shanns/comic (8), or numeric ID' },
              startElementId: { type: 'string', description: 'For arrows: ID of element to bind arrow start to' },
              endElementId: { type: 'string', description: 'For arrows: ID of element to bind arrow end to' },
              endArrowhead: { type: 'string', description: 'Arrowhead style at end: arrow, bar, dot, triangle, or null' },
              startArrowhead: { type: 'string', description: 'Arrowhead style at start: arrow, bar, dot, triangle, or null' }
            },
            required: ['type', 'x', 'y']
          }
        }
      },
      required: ['elements']
    }
  },
  {
    name: 'get_element',
    description: 'Get a single Excalidraw element by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The element ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'clear_canvas',
    description: 'Clear all elements from the canvas',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'export_scene',
    description: 'Export the current canvas to .excalidraw JSON format. Optionally write to a file; a path ending in .md is written in the Obsidian Excalidraw plugin format (.excalidraw.md).',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Optional file path to write the scene to (.excalidraw for raw JSON, .excalidraw.md for the Obsidian Excalidraw plugin format)'
        }
      }
    }
  },
  {
    name: 'import_scene',
    description: 'Import elements from a .excalidraw JSON file, an Obsidian .excalidraw.md file, or raw JSON data',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to a .excalidraw JSON or Obsidian .excalidraw.md file'
        },
        data: {
          type: 'string',
          description: 'Raw .excalidraw JSON string (alternative to filePath)'
        },
        mode: {
          type: 'string',
          enum: ['replace', 'merge'],
          description: '"replace" clears canvas first, "merge" appends to existing elements'
        }
      },
      required: ['mode']
    }
  },
  {
    name: 'export_to_image',
    description: 'Export the current canvas to PNG or SVG image. Requires the canvas frontend to be open in a browser.',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['png', 'svg'],
          description: 'Image format'
        },
        filePath: {
          type: 'string',
          description: 'Optional file path to save the image'
        },
        background: {
          type: 'boolean',
          description: 'Include background in export (default: true)'
        }
      },
      required: ['format']
    }
  },
  {
    name: 'duplicate_elements',
    description: 'Duplicate elements with a configurable offset',
    inputSchema: {
      type: 'object',
      properties: {
        elementIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'IDs of elements to duplicate'
        },
        offsetX: { type: 'number', description: 'Horizontal offset (default: 20)' },
        offsetY: { type: 'number', description: 'Vertical offset (default: 20)' }
      },
      required: ['elementIds']
    }
  },
  {
    name: 'snapshot_scene',
    description: 'Save a named snapshot of the current canvas state for later restoration',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for this snapshot'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'restore_snapshot',
    description: 'Restore the canvas from a previously saved named snapshot',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the snapshot to restore'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'describe_scene',
    description: 'Get an AI-readable description of the current canvas: element types, positions, connections, labels, spatial layout, and bounding box. Use this to understand what is on the canvas before making changes.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_canvas_screenshot',
    description: 'Take a screenshot of the current canvas and return it as an image. Requires the canvas frontend to be open in a browser. Use this to visually verify what the diagram looks like.',
    inputSchema: {
      type: 'object',
      properties: {
        background: {
          type: 'boolean',
          description: 'Include background in screenshot (default: true)'
        }
      }
    }
  },
  {
    name: 'read_diagram_guide',
    description: 'Returns a comprehensive design guide for creating beautiful Excalidraw diagrams: color palette, sizing rules, layout patterns, arrow binding best practices, diagram templates, and anti-patterns. Call this before creating diagrams to produce professional results.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'export_to_excalidraw_url',
    description: 'Export the current canvas to a shareable excalidraw.com URL. The diagram is encrypted and uploaded; anyone with the URL can view it. Returns the shareable link.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'set_viewport',
    description: 'Control the canvas viewport (camera). Auto-fit all elements, center on a specific element, or set zoom/scroll directly. Requires the canvas frontend open in a browser.',
    inputSchema: {
      type: 'object',
      properties: {
        scrollToContent: {
          type: 'boolean',
          description: 'Auto-fit all elements in view (zoom-to-fit)'
        },
        scrollToElementId: {
          type: 'string',
          description: 'Center the view on a specific element by ID'
        },
        zoom: {
          type: 'number',
          description: 'Zoom level (0.1–10, where 1 = 100%)'
        },
        offsetX: {
          type: 'number',
          description: 'Horizontal scroll offset'
        },
        offsetY: {
          type: 'number',
          description: 'Vertical scroll offset'
        }
      }
    }
  }
];

// Initialize MCP server
const server = new Server(
  {
    name: "mcp-excalidraw-server",
    version: packageVersion(),
    description: "Programmatic canvas toolkit for Excalidraw with file I/O, image export, and real-time sync"
  },
  {
    capabilities: {
      tools: Object.fromEntries(tools.map(tool => [tool.name, {
        description: tool.description,
        inputSchema: tool.inputSchema
      }]))
    }
  }
);

// Set up request handler for tool calls
server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  try {
    const { name, arguments: args } = request.params;
    logger.info(`Handling tool call: ${name}`);

    if (toolNeedsCanvasBeforeDispatch(name)) {
      await ensureCanvasReadyForMcpTool();
    }
    
    switch (name) {
      case 'create_element': {
        const params = ElementSchema.parse(args);
        logger.info('Creating element via MCP', { type: params.type });

        const excalidrawElement = prepareElement(params);

        // Create element directly on HTTP server (no local storage)
        const canvasElement = await createElementOnCanvas(excalidrawElement);

        if (!canvasElement) {
          throw new Error('Failed to create element: HTTP server unavailable');
        }

        logger.info('Element created via MCP and synced to canvas', {
          id: excalidrawElement.id,
          type: excalidrawElement.type,
          synced: !!canvasElement
        });

        return {
          content: [{
            type: 'text',
            text: `Element created successfully!\n\n${JSON.stringify(canvasElement, null, 2)}\n\n✅ Synced to canvas`
          }]
        };
      }
      case 'update_element': {
        const params = ElementIdSchema.merge(ElementSchema.partial()).parse(args);
        const { id, ...updates } = params;

        if (!id) throw new Error('Element ID is required');

        // Fetch the element's actual type so text→label conversion only
        // applies to non-text shapes (update payloads rarely carry `type`)
        const existing = await getElementFromCanvas(id);
        const excalidrawElement = prepareElementUpdate(id, updates, existing?.type);

        // Update element directly on HTTP server (no local storage)
        const canvasElement = await updateElementOnCanvas(excalidrawElement);
        
        if (!canvasElement) {
          throw new Error('Failed to update element: HTTP server unavailable or element not found');
        }
        
        logger.info('Element updated via MCP and synced to canvas', { 
          id: excalidrawElement.id, 
          synced: !!canvasElement 
        });
        
        return {
          content: [{ 
            type: 'text', 
            text: `Element updated successfully!\n\n${JSON.stringify(canvasElement, null, 2)}\n\n✅ Synced to canvas` 
          }]
        };
      }
      
      case 'delete_element': {
        const params = ElementIdSchema.parse(args);
        const { id } = params;

        // Delete element directly on HTTP server (no local storage)
        const canvasResult = await deleteElementOnCanvas(id);

        if (!canvasResult || !(canvasResult as ApiResponse).success) {
          throw new Error('Failed to delete element: HTTP server unavailable or element not found');
        }

        const result = { id, deleted: true, syncedToCanvas: true };
        logger.info('Element deleted via MCP and synced to canvas', result);

        return {
          content: [{
            type: 'text',
            text: `Element deleted successfully!\n\n${JSON.stringify(result, null, 2)}\n\n✅ Synced to canvas`
          }]
        };
      }
      
      case 'query_elements': {
        const params = QuerySchema.parse(args || {});
        const { type, filter, bbox } = params;

        try {
          // Build query parameters
          const queryParams = new URLSearchParams();
          if (type) queryParams.set('type', type);
          if (filter) {
            Object.entries(filter).forEach(([key, value]) => {
              queryParams.set(key, String(value));
            });
          }
          if (bbox) {
            if (bbox.x_min !== undefined) queryParams.set('x_min', String(bbox.x_min));
            if (bbox.x_max !== undefined) queryParams.set('x_max', String(bbox.x_max));
            if (bbox.y_min !== undefined) queryParams.set('y_min', String(bbox.y_min));
            if (bbox.y_max !== undefined) queryParams.set('y_max', String(bbox.y_max));
          }

          // Query elements from HTTP server
          const results = await searchElements(queryParams);

          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error) {
          throw new Error(`Failed to query elements: ${(error as Error).message}`);
        }
      }
      case 'get_resource': {
        const params = ResourceSchema.parse(args);
        const { resource } = params;
        logger.info('Getting resource', { resource });

        let result: any;
        switch (resource) {
          case 'scene':
            result = {
              theme: sceneState.theme,
              viewport: sceneState.viewport,
              selectedElements: Array.from(sceneState.selectedElements)
            };
            break;
          case 'library':
          case 'elements':
            try {
              await ensureCanvasReadyForMcpTool();
              // Get elements from HTTP server
              result = {
                elements: await getElements()
              };
            } catch (error) {
              throw new Error(`Failed to get elements: ${(error as Error).message}`);
            }
            break;
          case 'theme':
            result = {
              theme: sceneState.theme
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

        try {
          const result = await groupElements(elementIds);

          // Keep the legacy in-process group map in sync
          sceneState.groups.set(result.groupId, elementIds);

          logger.info('Grouping elements', { elementIds, groupId: result.groupId, successCount: result.successCount });

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error) {
          throw new Error(`Failed to group elements: ${(error as Error).message}`);
        }
      }
      case 'ungroup_elements': {
        const params = GroupIdSchema.parse(args);
        const { groupId } = params;

        try {
          // Prefer the legacy in-process member list when present; otherwise
          // canvas element groupIds are the source of truth (works even after
          // an MCP server restart).
          const knownMemberIds = sceneState.groups.get(groupId);
          const result = await ungroupElements(groupId, knownMemberIds);
          sceneState.groups.delete(groupId);

          logger.info('Ungrouping elements', { groupId, elementIds: result.elementIds, successCount: result.successCount });

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error) {
          throw new Error(`Failed to ungroup elements: ${(error as Error).message}`);
        }
      }
      case 'align_elements': {
        const params = AlignElementsSchema.parse(args);
        const { elementIds, alignment } = params;
        logger.info('Aligning elements', { elementIds, alignment });

        const result = await alignElements(elementIds, alignment);

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }
      case 'distribute_elements': {
        const params = DistributeElementsSchema.parse(args);
        const { elementIds, direction } = params;
        logger.info('Distributing elements', { elementIds, direction });

        const result = await distributeElements(elementIds, direction);

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }
      case 'lock_elements': {
        const params = ElementIdsSchema.parse(args);
        const { elementIds } = params;

        try {
          const { successCount } = await setElementsLocked(elementIds, true);

          const result = { locked: true, elementIds, successCount };
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error) {
          throw new Error(`Failed to lock elements: ${(error as Error).message}`);
        }
      }
      case 'unlock_elements': {
        const params = ElementIdsSchema.parse(args);
        const { elementIds } = params;

        try {
          const { successCount } = await setElementsLocked(elementIds, false);

          const result = { unlocked: true, elementIds, successCount };
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error) {
          throw new Error(`Failed to unlock elements: ${(error as Error).message}`);
        }
      }
      case 'create_from_mermaid': {
        const params = z.object({
          mermaidDiagram: z.string(),
          config: z.object({
            startOnLoad: z.boolean().optional(),
            flowchart: z.object({
              curve: z.enum(['linear', 'basis']).optional()
            }).optional(),
            themeVariables: z.object({
              fontSize: z.string().optional()
            }).optional(),
            maxEdges: z.number().optional(),
            maxTextSize: z.number().optional()
          }).optional()
        }).parse(args);

        logger.info('Creating Excalidraw elements from Mermaid diagram via MCP', {
          diagramLength: params.mermaidDiagram.length,
          hasConfig: !!params.config
        });

        try {
          // Send the Mermaid diagram to the frontend via the API
          // The frontend will use mermaid-to-excalidraw to convert it
          const result = await sendMermaid(params.mermaidDiagram, params.config);

          logger.info('Mermaid diagram sent to frontend for conversion', {
            success: result.success
          });

          return {
            content: [{
              type: 'text',
              text: `Mermaid diagram sent for conversion!\n\n${JSON.stringify(result, null, 2)}\n\n⚠️  Note: The actual conversion happens in the frontend canvas with DOM access. Open the canvas at ${EXPRESS_SERVER_URL} to see the diagram rendered.`
            }]
          };
        } catch (error) {
          throw new Error(`Failed to process Mermaid diagram: ${(error as Error).message}`);
        }
      }
      case 'batch_create_elements': {
        const params = z.object({ elements: z.array(ElementSchema) }).parse(args);
        logger.info('Batch creating elements via MCP', { count: params.elements.length });

        const createdElements: ServerElement[] = params.elements.map(elementData => prepareElement(elementData));

        const canvasElements = await batchCreateElementsOnCanvas(createdElements);

        if (!canvasElements) {
          throw new Error('Failed to batch create elements: HTTP server unavailable');
        }

        const result = {
          success: true,
          elements: canvasElements,
          count: canvasElements.length,
          syncedToCanvas: true
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
      case 'get_element': {
        const params = ElementIdSchema.parse(args);
        const { id } = params;

        const element = await getElementFromCanvas(id);
        if (!element) {
          throw new Error(`Element ${id} not found`);
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(element, null, 2) }]
        };
      }

      case 'clear_canvas': {
        logger.info('Clearing canvas via MCP');

        const data = await clearCanvas();

        return {
          content: [{
            type: 'text',
            text: `Canvas cleared.\n\n${JSON.stringify(data, null, 2)}`
          }]
        };
      }
      case 'export_scene': {
        const params = z.object({
          filePath: z.string().optional()
        }).parse(args || {});

        logger.info('Exporting scene via MCP');

        const { scene, elementCount } = await buildSceneFile();

        if (params.filePath) {
          const safePath = sanitizeFilePath(params.filePath);
          const asObsidianMd = params.filePath.endsWith('.md');
          const output = asObsidianMd
            ? wrapSceneAsObsidianMd(scene)
            : JSON.stringify(scene, null, 2);
          fs.writeFileSync(safePath, output, 'utf-8');
          return {
            content: [{
              type: 'text',
              text: `Scene exported to ${safePath} (${elementCount} elements${asObsidianMd ? ', Obsidian .excalidraw.md format' : ''})`
            }]
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(scene, null, 2)
          }]
        };
      }
      case 'import_scene': {
        const params = z.object({
          filePath: z.string().optional(),
          data: z.string().optional(),
          mode: z.enum(['replace', 'merge'])
        }).parse(args);

        logger.info('Importing scene via MCP', { mode: params.mode });

        const result = await importScene(params);

        return {
          content: [{
            type: 'text',
            text: `Imported ${result.count} elements${result.fileCount > 0 ? ` and ${result.fileCount} files` : ''} (mode: ${result.mode})\n\n✅ Synced to canvas`
          }]
        };
      }
      case 'export_to_image': {
        const params = z.object({
          format: z.enum(['png', 'svg']),
          filePath: z.string().optional(),
          background: z.boolean().optional()
        }).parse(args);

        logger.info('Exporting to image via MCP', { format: params.format });

        const result = await exportImage(params.format, params.background ?? true);

        if (params.filePath) {
          const safeImagePath = sanitizeFilePath(params.filePath);
          if (params.format === 'svg') {
            fs.writeFileSync(safeImagePath, result.data, 'utf-8');
          } else {
            fs.writeFileSync(safeImagePath, Buffer.from(result.data, 'base64'));
          }
          return {
            content: [{
              type: 'text',
              text: `Image exported to ${safeImagePath} (format: ${params.format})`
            }]
          };
        }

        return {
          content: [{
            type: 'text',
            text: params.format === 'svg'
              ? result.data
              : `Base64 ${params.format} data (${result.data.length} chars). Use filePath to save to disk.`
          }]
        };
      }
      case 'duplicate_elements': {
        const params = z.object({
          elementIds: z.array(z.string()),
          offsetX: z.number().optional(),
          offsetY: z.number().optional()
        }).parse(args);

        logger.info('Duplicating elements via MCP', { count: params.elementIds.length });

        const { duplicates, canvasElements, offsetX, offsetY } = await duplicateElements(
          params.elementIds,
          params.offsetX ?? 20,
          params.offsetY ?? 20
        );

        return {
          content: [{
            type: 'text',
            text: `Duplicated ${duplicates.length} elements (offset: ${offsetX}, ${offsetY})\n\n${JSON.stringify(canvasElements, null, 2)}\n\n✅ Synced to canvas`
          }]
        };
      }
      case 'snapshot_scene': {
        const params = z.object({ name: z.string() }).parse(args);
        logger.info('Saving snapshot via MCP', { name: params.name });

        const result = await saveSnapshot(params.name);

        return {
          content: [{
            type: 'text',
            text: `Snapshot "${params.name}" saved (${result.elementCount} elements)\n\n${JSON.stringify(result, null, 2)}`
          }]
        };
      }
      case 'restore_snapshot': {
        const params = z.object({ name: z.string() }).parse(args);
        logger.info('Restoring snapshot via MCP', { name: params.name });

        // Fetch the snapshot
        let snapshot: { name: string; elements: ServerElement[]; createdAt: string };
        try {
          snapshot = await getSnapshot(params.name);
        } catch {
          throw new Error(`Snapshot "${params.name}" not found`);
        }

        // Clear current canvas, then restore elements
        await clearCanvas();
        const restored = await batchCreateElementsOnCanvas(snapshot.elements);
        if (!restored) {
          throw new Error(`Failed to restore snapshot "${params.name}": HTTP server unavailable (canvas was cleared)`);
        }

        return {
          content: [{
            type: 'text',
            text: `Snapshot "${params.name}" restored (${snapshot.elements.length} elements)\n\n✅ Canvas updated`
          }]
        };
      }
      case 'describe_scene': {
        logger.info('Describing scene via MCP');

        const allElements = await getElements();

        return {
          content: [{ type: 'text', text: describeScene(allElements) }]
        };
      }
      case 'get_canvas_screenshot': {
        const params = z.object({
          background: z.boolean().optional()
        }).parse(args || {});

        logger.info('Taking canvas screenshot via MCP');

        const result = await exportImage('png', params.background ?? true);

        return {
          content: [
            {
              type: 'image' as const,
              data: result.data,
              mimeType: 'image/png'
            },
            {
              type: 'text',
              text: 'Canvas screenshot captured. This is what the diagram currently looks like.'
            }
          ]
        };
      }
      case 'read_diagram_guide': {
        return {
          content: [{ type: 'text', text: DIAGRAM_DESIGN_GUIDE }]
        };
      }

      case 'export_to_excalidraw_url': {
        logger.info('Exporting to excalidraw.com URL');

        const urlExportElements = await getElements();
        const shareUrl = await exportToExcalidrawUrl(urlExportElements);

        return {
          content: [{
            type: 'text',
            text: `Diagram exported to excalidraw.com!\n\nShareable URL: ${shareUrl}\n\nAnyone with this link can view and edit the diagram.`
          }]
        };
      }
      case 'set_viewport': {
        const viewportParams = z.object({
          scrollToContent: z.boolean().optional(),
          scrollToElementId: z.string().optional(),
          zoom: z.number().min(0.1).max(10).optional(),
          offsetX: z.number().optional(),
          offsetY: z.number().optional()
        }).parse(args || {});

        logger.info('Setting viewport via MCP', viewportParams);

        const viewportResult = await setViewport(viewportParams);

        return {
          content: [{
            type: 'text',
            text: `Viewport updated successfully.\n\n${JSON.stringify(viewportResult, null, 2)}`
          }]
        };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    logger.error(`Error handling tool call: ${(error as Error).message}`, { error });
    return {
      content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
      isError: true
    };
  }
});

// Set up request handler for listing available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.info('Listing available tools');
  return { tools };
});

// Start server
async function runServer(): Promise<void> {
  try {
    logger.info('Starting Excalidraw MCP server...');

    const transport = new StdioServerTransport();
    logger.debug('Connecting to stdio transport...');

    await server.connect(transport);
    logger.info('Excalidraw MCP server running on stdio');

    // Kick off auto-start after the stdio transport is connected so the MCP
    // handshake stays fast. Canvas-backed tools await the same promise before
    // touching HTTP, which avoids a first-tool race.
    if (ENABLE_CANVAS_SYNC && !EXCALIDRAW_NO_AUTOSTART) {
      void ensureCanvasReadyForMcpTool().catch(error => {
        logger.warn('Canvas auto-start failed:', (error as Error).message);
      });
    }

    process.stdin.resume();
  } catch (error) {
    logger.error('Error starting server:', error);
    process.stderr.write(`Failed to start MCP server: ${(error as Error).message}\n${(error as Error).stack}\n`);
    process.exit(1);
  }
}

// Add global error handlers
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception:', error);
  process.stderr.write(`UNCAUGHT EXCEPTION: ${error.message}\n${error.stack}\n`);
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled promise rejection:', reason);
  process.stderr.write(`UNHANDLED REJECTION: ${reason}\n`);
  setTimeout(() => process.exit(1), 1000);
});

// For testing and debugging purposes
if (process.env.DEBUG === 'true') {
  logger.debug('Debug mode enabled');
}

// Start the server if this file is run directly.
// npm/npx commonly invoke package bins through symlinks; isMainModule
// compares real paths so the stdio transport still starts from those
// standard install paths.
if (isMainModule(import.meta.url)) {
  runServer().catch(error => {
    logger.error('Failed to start server:', error);
    process.exit(1);
  });
}

export { runServer };
export default runServer;
