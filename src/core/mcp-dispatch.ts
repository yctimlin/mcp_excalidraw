import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import fs from 'fs';
import logger from '../utils/logger.js';
import {
  EXCALIDRAW_ELEMENT_TYPES,
  ServerElement,
  ExcalidrawElementType
} from '../types.js';
import { EXPRESS_SERVER_URL } from './config.js';
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
} from './canvas-client.js';
import { sanitizeFilePath, prepareElement, prepareElementUpdate } from './normalize.js';
import {
  alignElements,
  distributeElements,
  setElementsLocked,
  groupElements,
  ungroupElements,
  duplicateElements
} from './geometry.js';
import { buildSceneFile, importScene } from './scene-io.js';
import { wrapSceneAsObsidianMd } from './obsidian-md.js';
import { describeScene } from './describe.js';
import { exportToExcalidrawUrl } from './share-url.js';
import { DIAGRAM_DESIGN_GUIDE } from './design-guide.js';
import { sceneState, ensureCanvasReadyForMcpTool, toolNeedsCanvasBeforeDispatch } from './canvas-state.js';

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

/**
 * Dispatches one `tools/call` invocation. Era-agnostic on purpose: the same
 * dispatcher backs a 2025-era connection opened with `initialize` and a
 * 2026-07-28 connection that starts with `server/discover` (or with a bare
 * `tools/call`), so tool behaviour can never drift between the two.
 */
export async function callExcalidrawTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<CallToolResult> {
  try {
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
          scrollToElementIds: z.array(z.string().min(1)).min(1).optional(),
          viewportZoomFactor: z.number().positive().max(1).optional(),
          scrollToElementId: z.string().min(1).optional(),
          zoom: z.number().min(0.1).max(10).optional(),
          offsetX: z.number().optional(),
          offsetY: z.number().optional()
        }).superRefine((params, ctx) => {
          const modes = [
            params.scrollToContent === true,
            params.scrollToElementIds !== undefined,
            params.scrollToElementId !== undefined,
            params.zoom !== undefined || params.offsetX !== undefined || params.offsetY !== undefined
          ].filter(Boolean).length;

          if (modes !== 1) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Specify exactly one viewport mode: scrollToContent, scrollToElementIds, scrollToElementId, or manual zoom/offset'
            });
          }
          if (params.viewportZoomFactor !== undefined &&
              params.scrollToContent !== true &&
              params.scrollToElementIds === undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['viewportZoomFactor'],
              message: 'viewportZoomFactor requires scrollToContent or scrollToElementIds'
            });
          }
        }).parse(args || {});

        logger.info('Setting viewport via MCP', viewportParams);

        const viewportResult = await setViewport(viewportParams);

        if (!viewportResult.success) {
          throw new Error(viewportResult.message || 'Viewport update failed');
        }

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
}
