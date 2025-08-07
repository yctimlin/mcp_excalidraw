import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import logger from './utils/logger.js';
import { 
  elements,
  generateId, 
  EXCALIDRAW_ELEMENT_TYPES 
} from './types.js';
import { z } from 'zod';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the build directory
const staticDir = path.join(__dirname, '../dist');
app.use(express.static(staticDir));
// Also serve frontend assets
app.use(express.static(path.join(__dirname, '../dist/frontend')));

// WebSocket connections
const clients = new Set();

// Broadcast to all connected clients
function broadcast(message) {
  const data = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  });
}

// WebSocket connection handling
wss.on('connection', (ws) => {
  clients.add(ws);
  logger.info('New WebSocket connection established');
  
  // Send current elements to new client
  ws.send(JSON.stringify({
    type: 'initial_elements',
    elements: Array.from(elements.values())
  }));
  
  // Send sync status to new client
  ws.send(JSON.stringify({
    type: 'sync_status',
    elementCount: elements.size,
    timestamp: new Date().toISOString()
  }));
  
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
  type: z.enum(Object.values(EXCALIDRAW_ELEMENT_TYPES)),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  backgroundColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  roughness: z.number().optional(),
  opacity: z.number().optional(),
  text: z.string().optional(),
  label: z.object({
    text: z.string()
  }).optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional()
});

const UpdateElementSchema = z.object({
  id: z.string(),
  type: z.enum(Object.values(EXCALIDRAW_ELEMENT_TYPES)).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  backgroundColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  roughness: z.number().optional(),
  opacity: z.number().optional(),
  text: z.string().optional(),
  label: z.object({
    text: z.string()
  }).optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional()
});

// API Routes

// Get all elements
app.get('/api/elements', (req, res) => {
  try {
    const elementsArray = Array.from(elements.values());
    res.json({
      success: true,
      elements: elementsArray,
      count: elementsArray.length
    });
  } catch (error) {
    logger.error('Error fetching elements:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create new element
app.post('/api/elements', (req, res) => {
  try {
    const params = CreateElementSchema.parse(req.body);
    logger.info('Creating element via API', { type: params.type });

    // Prioritize passed ID (for MCP sync), otherwise generate new ID
    const id = params.id || generateId();
    const element = {
      id,
      ...params,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    };

    elements.set(id, element);
    
    // Broadcast to all connected clients
    broadcast({
      type: 'element_created',
      element: element
    });
    
    res.json({
      success: true,
      element: element
    });
  } catch (error) {
    logger.error('Error creating element:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Update element
app.put('/api/elements/:id', (req, res) => {
  try {
    const { id } = req.params;
    const updates = UpdateElementSchema.parse({ id, ...req.body });
    
    const existingElement = elements.get(id);
    if (!existingElement) {
      return res.status(404).json({
        success: false,
        error: `Element with ID ${id} not found`
      });
    }

    const updatedElement = {
      ...existingElement,
      ...updates,
      updatedAt: new Date().toISOString(),
      version: existingElement.version + 1
    };

    elements.set(id, updatedElement);
    
    // Broadcast to all connected clients
    broadcast({
      type: 'element_updated',
      element: updatedElement
    });
    
    res.json({
      success: true,
      element: updatedElement
    });
  } catch (error) {
    logger.error('Error updating element:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Delete element
app.delete('/api/elements/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    if (!elements.has(id)) {
      return res.status(404).json({
        success: false,
        error: `Element with ID ${id} not found`
      });
    }
    
    elements.delete(id);
    
    // Broadcast to all connected clients
    broadcast({
      type: 'element_deleted',
      elementId: id
    });
    
    res.json({
      success: true,
      message: `Element ${id} deleted successfully`
    });
  } catch (error) {
    logger.error('Error deleting element:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Query elements with filters
app.get('/api/elements/search', (req, res) => {
  try {
    const { type, ...filters } = req.query;
    let results = Array.from(elements.values());
    
    // Filter by type if specified
    if (type) {
      results = results.filter(element => element.type === type);
    }
    
    // Apply additional filters
    if (Object.keys(filters).length > 0) {
      results = results.filter(element => {
        return Object.entries(filters).every(([key, value]) => {
          return element[key] === value;
        });
      });
    }
    
    res.json({
      success: true,
      elements: results,
      count: results.length
    });
  } catch (error) {
    logger.error('Error querying elements:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get element by ID
app.get('/api/elements/:id', (req, res) => {
  try {
    const { id } = req.params;
    const element = elements.get(id);
    
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
      error: error.message
    });
  }
});

// Batch create elements
app.post('/api/elements/batch', (req, res) => {
  try {
    const { elements: elementsToCreate } = req.body;
    
    if (!Array.isArray(elementsToCreate)) {
      return res.status(400).json({
        success: false,
        error: 'Expected an array of elements'
      });
    }
    
    const createdElements = [];
    
    elementsToCreate.forEach(elementData => {
      const params = CreateElementSchema.parse(elementData);
      const id = generateId();
      const element = {
        id,
        ...params,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      };
      
      elements.set(id, element);
      createdElements.push(element);
    });
    
    // Broadcast to all connected clients
    broadcast({
      type: 'elements_batch_created',
      elements: createdElements
    });
    
    res.json({
      success: true,
      elements: createdElements,
      count: createdElements.length
    });
  } catch (error) {
    logger.error('Error batch creating elements:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Sync elements from frontend (overwrite sync)
app.post('/api/elements/sync', (req, res) => {
  try {
    const { elements: frontendElements, timestamp } = req.body;
    
    logger.info(`Sync request received: ${frontendElements.length} elements`, {
      timestamp,
      elementCount: frontendElements.length
    });
    
    // Validate input data
    if (!Array.isArray(frontendElements)) {
      return res.status(400).json({
        success: false,
        error: 'Expected elements to be an array'
      });
    }
    
    // Record element count before sync
    const beforeCount = elements.size;
    
    // 1. Clear existing memory storage
    elements.clear();
    logger.info(`Cleared existing elements: ${beforeCount} elements removed`);
    
    // 2. Batch write new data
    let successCount = 0;
    const processedElements = [];
    
    frontendElements.forEach((element, index) => {
      try {
        // Ensure element has ID, generate one if missing
        const elementId = element.id || generateId();
        
        // Add server metadata
        const processedElement = {
          ...element,
          id: elementId,
          syncedAt: new Date().toISOString(),
          source: 'frontend_sync',
          syncTimestamp: timestamp,
          version: 1
        };
        
        // Store to memory
        elements.set(elementId, processedElement);
        processedElements.push(processedElement);
        successCount++;
        
      } catch (elementError) {
        logger.warn(`Failed to process element ${index}:`, elementError);
      }
    });
    
    logger.info(`Sync completed: ${successCount}/${frontendElements.length} elements synced`);
    
    // 3. Broadcast sync event to all WebSocket clients
    broadcast({
      type: 'elements_synced',
      count: successCount,
      timestamp: new Date().toISOString(),
      source: 'manual_sync'
    });
    
    // 4. Return sync results
    res.json({
      success: true,
      message: `Successfully synced ${successCount} elements`,
      count: successCount,
      syncedAt: new Date().toISOString(),
      beforeCount,
      afterCount: elements.size
    });
    
  } catch (error) {
    logger.error('Sync error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Internal server error during sync operation'
    });
  }
});

// Serve the frontend
app.get('/', (req, res) => {
  const htmlFile = path.join(__dirname, '../dist/frontend/index.html');
  res.sendFile(htmlFile, (err) => {
    if (err) {
      logger.error('Error serving frontend:', err);
      res.status(404).send('Frontend not found. Please run "npm run build" first.');
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    elements_count: elements.size,
    websocket_clients: clients.size
  });
});

// Sync status endpoint
app.get('/api/sync/status', (req, res) => {
  res.json({
    success: true,
    elementCount: elements.size,
    timestamp: new Date().toISOString(),
    memoryUsage: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024), // MB
    },
    websocketClients: clients.size
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Start server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

server.listen(PORT, HOST, () => {
  logger.info(`POC server running on http://${HOST}:${PORT}`);
  logger.info(`WebSocket server running on ws://${HOST}:${PORT}`);
});

export default app; 