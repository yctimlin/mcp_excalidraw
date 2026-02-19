import express, { type Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import logger from './utils/logger.js';
import {
  generateId,
  EXCALIDRAW_ELEMENT_TYPES,
  ServerElement,
  ExcalidrawElementType,
  WebSocketMessage,
  ElementCreatedMessage,
  ElementUpdatedMessage,
  ElementDeletedMessage,
  BatchCreatedMessage,
  SyncStatusMessage,
  InitialElementsMessage,
  Snapshot
} from './types.js';
import * as store from './db.js';
import { listTenants as dbListTenants, getActiveTenant as dbGetActiveTenant, setActiveTenant as dbSetActiveTenant, getDefaultProjectForTenant } from './db.js';
import { z } from 'zod';
import WebSocket from 'ws';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Application = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static files from the build directory
const staticDir = path.join(__dirname, '../dist');
app.use(express.static(staticDir));
// Also serve frontend assets
app.use(express.static(path.join(__dirname, '../dist/frontend')));

// Resolve tenant from X-Tenant-Id header to a projectId override.
// Returns undefined when header is absent (browser requests), falling back to global state.
function resolveTenantProject(req: Request): string | undefined {
  const tenantId = req.headers['x-tenant-id'] as string | undefined;
  if (!tenantId) return undefined;
  return getDefaultProjectForTenant(tenantId);
}

// WebSocket connections
const clients = new Set<WebSocket>();

// Broadcast to all connected clients
function broadcast(message: WebSocketMessage): void {
  const data = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// WebSocket connection handling
wss.on('connection', (ws: WebSocket) => {
  clients.add(ws);
  logger.info('New WebSocket connection established');

  // Send current tenant info
  try {
    const tenant = dbGetActiveTenant();
    ws.send(JSON.stringify({
      type: 'tenant_switched',
      tenant: { id: tenant.id, name: tenant.name, workspace_path: tenant.workspace_path }
    }));
  } catch {}
  
  // Send current elements to new client
  const initialMessage: InitialElementsMessage = {
    type: 'initial_elements',
    elements: store.getAllElements()
  };
  ws.send(JSON.stringify(initialMessage));
  
  // Send sync status to new client
  const syncMessage: SyncStatusMessage = {
    type: 'sync_status',
    elementCount: store.getElementCount(),
    timestamp: new Date().toISOString()
  };
  ws.send(JSON.stringify(syncMessage));
  
  ws.on('close', () => {
    clients.delete(ws);
    logger.info('WebSocket connection closed');
  });
  
  ws.on('error', (error) => {
    logger.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

// Schema validation
const CreateElementSchema = z.object({
  id: z.string().optional(), // Allow passing ID for MCP sync
  type: z.enum(Object.values(EXCALIDRAW_ELEMENT_TYPES) as [ExcalidrawElementType, ...ExcalidrawElementType[]]),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  backgroundColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  strokeStyle: z.string().optional(),
  roughness: z.number().optional(),
  opacity: z.number().optional(),
  text: z.string().optional(),
  label: z.object({
    text: z.string()
  }).optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional(),
  groupIds: z.array(z.string()).optional(),
  locked: z.boolean().optional(),
  roundness: z.object({ type: z.number(), value: z.number().optional() }).nullable().optional(),
  fillStyle: z.string().optional(),
  // Arrow-specific properties
  points: z.any().optional(),
  start: z.object({ id: z.string() }).optional(),
  end: z.object({ id: z.string() }).optional(),
  startArrowhead: z.string().nullable().optional(),
  endArrowhead: z.string().nullable().optional(),
  elbowed: z.boolean().optional(),
});

const UpdateElementSchema = z.object({
  id: z.string(),
  type: z.enum(Object.values(EXCALIDRAW_ELEMENT_TYPES) as [ExcalidrawElementType, ...ExcalidrawElementType[]]).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  backgroundColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  strokeStyle: z.string().optional(),
  roughness: z.number().optional(),
  opacity: z.number().optional(),
  text: z.string().optional(),
  label: z.object({
    text: z.string()
  }).optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional(),
  groupIds: z.array(z.string()).optional(),
  locked: z.boolean().optional(),
  roundness: z.object({ type: z.number(), value: z.number().optional() }).nullable().optional(),
  fillStyle: z.string().optional(),
  points: z.array(z.union([
    z.tuple([z.number(), z.number()]),
    z.object({ x: z.number(), y: z.number() })
  ])).optional(),
  start: z.object({ id: z.string() }).optional(),
  end: z.object({ id: z.string() }).optional(),
  startArrowhead: z.string().nullable().optional(),
  endArrowhead: z.string().nullable().optional(),
  elbowed: z.boolean().optional(),
});

// API Routes

// Get all elements
app.get('/api/elements', (req: Request, res: Response) => {
  try {
    const projId = resolveTenantProject(req);
    const allElements = store.getAllElements(projId);
    res.json({
      success: true,
      elements: allElements,
      count: allElements.length
    });
  } catch (error) {
    logger.error('Error fetching elements:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Create new element
app.post('/api/elements', (req: Request, res: Response) => {
  try {
    const projId = resolveTenantProject(req);
    const params = CreateElementSchema.parse(req.body);
    logger.info('Creating element via API', { type: params.type });

    const id = params.id || generateId();
    const element: ServerElement = {
      id,
      ...params,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    };

    store.setElement(id, element, projId);
    
    const message: ElementCreatedMessage = {
      type: 'element_created',
      element: element
    };
    broadcast(message);
    
    res.json({
      success: true,
      element: element
    });
  } catch (error) {
    logger.error('Error creating element:', error);
    res.status(400).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Update element
app.put('/api/elements/:id', (req: Request, res: Response) => {
  try {
    const projId = resolveTenantProject(req);
    const { id } = req.params;
    const updates = UpdateElementSchema.parse({ id, ...req.body });
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Element ID is required'
      });
    }
    
    const existingElement = store.getElement(id, projId);
    if (!existingElement) {
      return res.status(404).json({
        success: false,
        error: `Element with ID ${id} not found`
      });
    }

    const updatedElement: ServerElement = {
      ...existingElement,
      ...updates,
      updatedAt: new Date().toISOString(),
      version: (existingElement.version || 0) + 1
    };

    store.setElement(id, updatedElement, projId);
    
    const message: ElementUpdatedMessage = {
      type: 'element_updated',
      element: updatedElement
    };
    broadcast(message);
    
    res.json({
      success: true,
      element: updatedElement
    });
  } catch (error) {
    logger.error('Error updating element:', error);
    res.status(400).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Clear all elements (must be before /:id route)
app.delete('/api/elements/clear', (req: Request, res: Response) => {
  try {
    const projId = resolveTenantProject(req);
    const count = store.clearElements(projId);

    broadcast({
      type: 'canvas_cleared',
      timestamp: new Date().toISOString()
    });

    logger.info(`Canvas cleared: ${count} elements removed`);

    res.json({
      success: true,
      message: `Cleared ${count} elements`,
      count
    });
  } catch (error) {
    logger.error('Error clearing canvas:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Delete element
app.delete('/api/elements/:id', (req: Request, res: Response) => {
  try {
    const projId = resolveTenantProject(req);
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Element ID is required'
      });
    }
    
    if (!store.hasElement(id, projId)) {
      return res.status(404).json({
        success: false,
        error: `Element with ID ${id} not found`
      });
    }
    
    store.deleteElement(id, projId);
    
    // Broadcast to all connected clients
    const message: ElementDeletedMessage = {
      type: 'element_deleted',
      elementId: id!
    };
    broadcast(message);
    
    res.json({
      success: true,
      message: `Element ${id} deleted successfully`
    });
  } catch (error) {
    logger.error('Error deleting element:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Query elements with filters
app.get('/api/elements/search', (req: Request, res: Response) => {
  try {
    const projId = resolveTenantProject(req);
    const { type, q, ...filters } = req.query;

    if (q && typeof q === 'string') {
      const results = store.searchElements(q, projId);
      return res.json({ success: true, elements: results, count: results.length });
    }

    const results = store.queryElements(
      type && typeof type === 'string' ? type : undefined,
      Object.keys(filters).length > 0 ? filters as Record<string, any> : undefined,
      projId
    );
    
    res.json({
      success: true,
      elements: results,
      count: results.length
    });
  } catch (error) {
    logger.error('Error querying elements:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Get element by ID
app.get('/api/elements/:id', (req: Request, res: Response) => {
  try {
    const projId = resolveTenantProject(req);
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Element ID is required'
      });
    }
    
    const element = store.getElement(id, projId);
    
    if (!element) {
      return res.status(404).json({
        success: false,
        error: `Element with ID ${id} not found`
      });
    }
    
    res.json({
      success: true,
      element: element
    });
  } catch (error) {
    logger.error('Error fetching element:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Helper: compute edge point for an element given a direction toward a target
function computeEdgePoint(
  el: ServerElement,
  targetCenterX: number,
  targetCenterY: number
): { x: number; y: number } {
  const cx = el.x + (el.width || 0) / 2;
  const cy = el.y + (el.height || 0) / 2;
  const dx = targetCenterX - cx;
  const dy = targetCenterY - cy;

  if (el.type === 'diamond') {
    // Diamond edge: use diamond geometry (rotated square)
    const hw = (el.width || 0) / 2;
    const hh = (el.height || 0) / 2;
    if (dx === 0 && dy === 0) return { x: cx, y: cy + hh };
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    // Scale factor to reach diamond edge
    const scale = (absDx / hw + absDy / hh) > 0
      ? 1 / (absDx / hw + absDy / hh)
      : 1;
    return { x: cx + dx * scale, y: cy + dy * scale };
  }

  if (el.type === 'ellipse') {
    // Ellipse edge: parametric intersection
    const a = (el.width || 0) / 2;
    const b = (el.height || 0) / 2;
    if (dx === 0 && dy === 0) return { x: cx, y: cy + b };
    const angle = Math.atan2(dy, dx);
    return { x: cx + a * Math.cos(angle), y: cy + b * Math.sin(angle) };
  }

  // Rectangle: find intersection with edges
  const hw = (el.width || 0) / 2;
  const hh = (el.height || 0) / 2;
  if (dx === 0 && dy === 0) return { x: cx, y: cy + hh };
  const angle = Math.atan2(dy, dx);
  const tanA = Math.tan(angle);
  // Check if ray intersects top/bottom edge or left/right edge
  if (Math.abs(tanA * hw) <= hh) {
    // Intersects left or right edge
    const signX = dx >= 0 ? 1 : -1;
    return { x: cx + signX * hw, y: cy + signX * hw * tanA };
  } else {
    // Intersects top or bottom edge
    const signY = dy >= 0 ? 1 : -1;
    return { x: cx + signY * hh / tanA, y: cy + signY * hh };
  }
}

// Helper: resolve arrow bindings in a batch
function resolveArrowBindings(batchElements: ServerElement[], projectId?: string): void {
  const elementMap = new Map<string, ServerElement>();
  batchElements.forEach(el => elementMap.set(el.id, el));

  // Also check existing elements for cross-batch references
  for (const el of store.getAllElements(projectId)) {
    if (!elementMap.has(el.id)) elementMap.set(el.id, el);
  }

  for (const el of batchElements) {
    if (el.type !== 'arrow' && el.type !== 'line') continue;
    const startRef = (el as any).start as { id: string } | undefined;
    const endRef = (el as any).end as { id: string } | undefined;

    if (!startRef && !endRef) continue;

    const startEl = startRef ? elementMap.get(startRef.id) : undefined;
    const endEl = endRef ? elementMap.get(endRef.id) : undefined;

    // Calculate arrow path from edge to edge
    const startCenter = startEl
      ? { x: startEl.x + (startEl.width || 0) / 2, y: startEl.y + (startEl.height || 0) / 2 }
      : { x: el.x, y: el.y };
    const endCenter = endEl
      ? { x: endEl.x + (endEl.width || 0) / 2, y: endEl.y + (endEl.height || 0) / 2 }
      : { x: el.x + 100, y: el.y };

    const GAP = 8;
    const startPt = startEl
      ? computeEdgePoint(startEl, endCenter.x, endCenter.y)
      : startCenter;
    const endPt = endEl
      ? computeEdgePoint(endEl, startCenter.x, startCenter.y)
      : endCenter;

    // Apply gap: move start point slightly away from source, end point slightly away from target
    const startDx = endPt.x - startPt.x;
    const startDy = endPt.y - startPt.y;
    const startDist = Math.sqrt(startDx * startDx + startDy * startDy) || 1;
    const endDx = startPt.x - endPt.x;
    const endDy = startPt.y - endPt.y;
    const endDist = Math.sqrt(endDx * endDx + endDy * endDy) || 1;

    const finalStart = {
      x: startPt.x + (startDx / startDist) * GAP,
      y: startPt.y + (startDy / startDist) * GAP
    };
    const finalEnd = {
      x: endPt.x + (endDx / endDist) * GAP,
      y: endPt.y + (endDy / endDist) * GAP
    };

    // Set arrow position and points
    el.x = finalStart.x;
    el.y = finalStart.y;
    el.points = [[0, 0], [finalEnd.x - finalStart.x, finalEnd.y - finalStart.y]];

    // Remove start/end refs (they were used for computation only)
    delete (el as any).start;
    delete (el as any).end;

    // Set binding metadata for Excalidraw
    if (startEl) {
      (el as any).startBinding = {
        elementId: startEl.id,
        focus: 0,
        gap: GAP
      };
    }
    if (endEl) {
      (el as any).endBinding = {
        elementId: endEl.id,
        focus: 0,
        gap: GAP
      };
    }
  }
}

// Batch create elements
app.post('/api/elements/batch', (req: Request, res: Response) => {
  try {
    const projId = resolveTenantProject(req);
    const { elements: elementsToCreate } = req.body;

    if (!Array.isArray(elementsToCreate)) {
      return res.status(400).json({
        success: false,
        error: 'Expected an array of elements'
      });
    }

    const createdElements: ServerElement[] = [];

    elementsToCreate.forEach(elementData => {
      const params = CreateElementSchema.parse(elementData);
      const id = params.id || generateId();
      const element: ServerElement = {
        id,
        ...params,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      };

      createdElements.push(element);
    });

    resolveArrowBindings(createdElements, projId);

    createdElements.forEach(el => store.setElement(el.id, el, projId));

    // Broadcast to all connected clients
    const message: BatchCreatedMessage = {
      type: 'elements_batch_created',
      elements: createdElements
    };
    broadcast(message);

    res.json({
      success: true,
      elements: createdElements,
      count: createdElements.length
    });
  } catch (error) {
    logger.error('Error batch creating elements:', error);
    res.status(400).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Convert Mermaid diagram to Excalidraw elements
app.post('/api/elements/from-mermaid', (req: Request, res: Response) => {
  try {
    const { mermaidDiagram, config } = req.body;
    
    if (!mermaidDiagram || typeof mermaidDiagram !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Mermaid diagram definition is required'
      });
    }
    
    logger.info('Received Mermaid conversion request', { 
      diagramLength: mermaidDiagram.length,
      hasConfig: !!config 
    });
    
    // Broadcast to all WebSocket clients to process the Mermaid diagram
    broadcast({
      type: 'mermaid_convert',
      mermaidDiagram,
      config: config || {},
      timestamp: new Date().toISOString()
    });
    
    // Return the diagram for frontend processing
    res.json({
      success: true,
      mermaidDiagram,
      config: config || {},
      message: 'Mermaid diagram sent to frontend for conversion.'
    });
  } catch (error) {
    logger.error('Error processing Mermaid diagram:', error);
    res.status(400).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Sync elements from frontend (overwrite sync)
app.post('/api/elements/sync', (req: Request, res: Response) => {
  try {
    const projId = resolveTenantProject(req);
    const { elements: frontendElements, timestamp } = req.body;
    
    logger.info(`Sync request received: ${frontendElements.length} elements`, {
      timestamp,
      elementCount: frontendElements.length
    });
    
    if (!Array.isArray(frontendElements)) {
      return res.status(400).json({
        success: false,
        error: 'Expected elements to be an array'
      });
    }
    
    const beforeCount = store.getElementCount(projId);

    // Process elements with server metadata
    const processedElements: ServerElement[] = [];
    let successCount = 0;

    frontendElements.forEach((element: any, index: number) => {
      try {
        const elementId = element.id || generateId();
        const processedElement: ServerElement = {
          ...element,
          id: elementId,
          syncedAt: new Date().toISOString(),
          source: 'frontend_sync',
          syncTimestamp: timestamp,
          version: 1
        };
        processedElements.push(processedElement);
        successCount++;
      } catch (elementError) {
        logger.warn(`Failed to process element ${index}:`, elementError);
      }
    });

    store.bulkReplaceElements(processedElements, projId);
    logger.info(`Sync completed: ${successCount}/${frontendElements.length} elements synced`);

    broadcast({
      type: 'elements_synced',
      count: successCount,
      timestamp: new Date().toISOString(),
      source: 'manual_sync'
    });

    res.json({
      success: true,
      message: `Successfully synced ${successCount} elements`,
      count: successCount,
      syncedAt: new Date().toISOString(),
      beforeCount,
      afterCount: store.getElementCount(projId)
    });
    
  } catch (error) {
    logger.error('Sync error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
      details: 'Internal server error during sync operation'
    });
  }
});

// Image export: request (MCP -> Express -> WebSocket -> Frontend)
interface PendingExport {
  resolve: (data: { format: string; data: string }) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}
const pendingExports = new Map<string, PendingExport>();

app.post('/api/export/image', (req: Request, res: Response) => {
  try {
    const { format, background } = req.body;

    if (!format || !['png', 'svg'].includes(format)) {
      return res.status(400).json({
        success: false,
        error: 'format must be "png" or "svg"'
      });
    }

    if (clients.size === 0) {
      return res.status(503).json({
        success: false,
        error: 'No frontend client connected. Open the canvas in a browser first.'
      });
    }

    const requestId = generateId();

    const exportPromise = new Promise<{ format: string; data: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingExports.delete(requestId);
        reject(new Error('Export timed out after 30 seconds'));
      }, 30000);

      pendingExports.set(requestId, { resolve, reject, timeout });
    });

    broadcast({
      type: 'export_image_request',
      requestId,
      format,
      background: background ?? true
    });

    exportPromise
      .then(result => {
        res.json({
          success: true,
          format: result.format,
          data: result.data
        });
      })
      .catch(error => {
        res.status(500).json({
          success: false,
          error: (error as Error).message
        });
      });
  } catch (error) {
    logger.error('Error initiating image export:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Image export: result (Frontend -> Express -> MCP)
app.post('/api/export/image/result', (req: Request, res: Response) => {
  try {
    const { requestId, format, data, error } = req.body;

    if (!requestId) {
      return res.status(400).json({
        success: false,
        error: 'requestId is required'
      });
    }

    const pending = pendingExports.get(requestId);
    if (!pending) {
      // Already resolved by another client, or expired — ignore silently
      return res.json({ success: true });
    }

    if (error) {
      // Don't reject on error — another WebSocket client may still succeed.
      // The timeout will handle the case where ALL clients fail.
      logger.warn(`Export error from one client (requestId=${requestId}): ${error}`);
      return res.json({ success: true });
    }

    clearTimeout(pending.timeout);
    pendingExports.delete(requestId);
    pending.resolve({ format, data });

    res.json({ success: true });
  } catch (error) {
    logger.error('Error processing export result:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Viewport control: request (MCP -> Express -> WebSocket -> Frontend)
interface PendingViewport {
  resolve: (data: { success: boolean; message: string }) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}
const pendingViewports = new Map<string, PendingViewport>();

app.post('/api/viewport', (req: Request, res: Response) => {
  try {
    const { scrollToContent, scrollToElementId, zoom, offsetX, offsetY } = req.body;

    if (clients.size === 0) {
      return res.status(503).json({
        success: false,
        error: 'No frontend client connected. Open the canvas in a browser first.'
      });
    }

    const requestId = generateId();

    const viewportPromise = new Promise<{ success: boolean; message: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingViewports.delete(requestId);
        reject(new Error('Viewport request timed out after 10 seconds'));
      }, 10000);

      pendingViewports.set(requestId, { resolve, reject, timeout });
    });

    broadcast({
      type: 'set_viewport',
      requestId,
      scrollToContent,
      scrollToElementId,
      zoom,
      offsetX,
      offsetY
    });

    viewportPromise
      .then(result => {
        res.json(result);
      })
      .catch(error => {
        res.status(500).json({
          success: false,
          error: (error as Error).message
        });
      });
  } catch (error) {
    logger.error('Error initiating viewport change:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Viewport control: result (Frontend -> Express -> MCP)
app.post('/api/viewport/result', (req: Request, res: Response) => {
  try {
    const { requestId, success, message, error } = req.body;

    if (!requestId) {
      return res.status(400).json({
        success: false,
        error: 'requestId is required'
      });
    }

    const pending = pendingViewports.get(requestId);
    if (!pending) {
      return res.json({ success: true });
    }

    if (error) {
      clearTimeout(pending.timeout);
      pendingViewports.delete(requestId);
      pending.resolve({ success: false, message: error });
      return res.json({ success: true });
    }

    clearTimeout(pending.timeout);
    pendingViewports.delete(requestId);
    pending.resolve({ success: true, message: message || 'Viewport updated' });

    res.json({ success: true });
  } catch (error) {
    logger.error('Error processing viewport result:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Snapshots: save
app.post('/api/snapshots', (req: Request, res: Response) => {
  try {
    const projId = resolveTenantProject(req);
    const { name } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Snapshot name is required'
      });
    }

    const allElements = store.getAllElements(projId);
    store.saveSnapshot(name, allElements, projId);
    logger.info(`Snapshot saved: "${name}" with ${allElements.length} elements`);

    res.json({
      success: true,
      name,
      elementCount: allElements.length,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error saving snapshot:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Snapshots: list
app.get('/api/snapshots', (req: Request, res: Response) => {
  try {
    const projId = resolveTenantProject(req);
    const list = store.listSnapshots(projId);

    res.json({
      success: true,
      snapshots: list,
      count: list.length
    });
  } catch (error) {
    logger.error('Error listing snapshots:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Snapshots: get by name
app.get('/api/snapshots/:name', (req: Request, res: Response) => {
  try {
    const projId = resolveTenantProject(req);
    const { name } = req.params;
    const snapshot = store.getSnapshot(name!, projId);

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: `Snapshot "${name}" not found`
      });
    }

    res.json({
      success: true,
      snapshot
    });
  } catch (error) {
    logger.error('Error fetching snapshot:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// Serve the frontend
app.get('/', (req: Request, res: Response) => {
  const htmlFile = path.join(__dirname, '../dist/frontend/index.html');
  res.sendFile(htmlFile, (err) => {
    if (err) {
      logger.error('Error serving frontend:', err);
      res.status(404).send('Frontend not found. Please run "npm run build" first.');
    }
  });
});

// ── Tenant API ──

app.get('/api/tenants', (req: Request, res: Response) => {
  try {
    const tenants = dbListTenants();
    const active = dbGetActiveTenant();
    res.json({ success: true, tenants, activeTenantId: active.id });
  } catch (error) {
    logger.error('Error listing tenants:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get('/api/tenant/active', (req: Request, res: Response) => {
  try {
    const tenant = dbGetActiveTenant();
    res.json({ success: true, tenant });
  } catch (error) {
    logger.error('Error getting active tenant:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.put('/api/tenant/active', (req: Request, res: Response) => {
  try {
    const { tenantId } = req.body;
    if (!tenantId || typeof tenantId !== 'string') {
      return res.status(400).json({ success: false, error: 'tenantId is required' });
    }

    dbSetActiveTenant(tenantId);
    const tenant = dbGetActiveTenant();

    broadcast({
      type: 'tenant_switched',
      tenant: { id: tenant.id, name: tenant.name, workspace_path: tenant.workspace_path }
    });

    res.json({ success: true, tenant });
  } catch (error) {
    logger.error('Error switching tenant:', error);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  const projId = resolveTenantProject(req);
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    elements_count: store.getElementCount(projId),
    websocket_clients: clients.size
  });
});

// Sync status endpoint
app.get('/api/sync/status', (req: Request, res: Response) => {
  const projId = resolveTenantProject(req);
  res.json({
    success: true,
    elementCount: store.getElementCount(projId),
    timestamp: new Date().toISOString(),
    memoryUsage: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024), // MB
    },
    websocketClients: clients.size
  });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Server configuration
const PORT = parseInt(process.env.CANVAS_PORT || process.env.PORT || '3000', 10);
const HOST = process.env.HOST || 'localhost';

export function startCanvasServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      httpServer.removeListener('error', onError);
      reject(err);
    };
    httpServer.on('error', onError);

    httpServer.listen(PORT, HOST, () => {
      httpServer.removeListener('error', onError);
      logger.info(`Canvas server running on http://${HOST}:${PORT}`);
      logger.info(`WebSocket server running on ws://${HOST}:${PORT}`);
      resolve();
    });
  });
}

export function stopCanvasServer(): Promise<void> {
  return new Promise((resolve) => {
    clients.forEach(c => c.close());
    httpServer.close(() => resolve());
  });
}

// Direct execution: `node dist/server.js` still works standalone
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  startCanvasServer().catch((err) => {
    logger.error('Failed to start canvas server:', err);
    process.exit(1);
  });
}

export default app;