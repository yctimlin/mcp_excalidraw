import logger from '../utils/logger.js';
import { redisMemory, DiagramChange } from './RedisMemoryService.js';
import { ServerElement } from '../types.js';
import fetch from 'node-fetch';

interface ApiResponse {
  success: boolean;
  elements?: ServerElement[];
  element?: ServerElement;
  count?: number;
  error?: string;
  message?: string;
}

export class PollingService {
  private pollInterval: NodeJS.Timeout | null = null;
  private isPolling = false;
  private pollIntervalMs: number;
  private lastKnownState: Map<string, ServerElement> = new Map();
  private expressServerUrl: string;

  constructor(pollIntervalMs: number = 2000) {
    this.pollIntervalMs = pollIntervalMs;
    this.expressServerUrl = process.env.EXPRESS_SERVER_URL || 'http://localhost:3000';
  }

  async start(): Promise<void> {
    if (this.isPolling) {
      logger.warn('Polling service is already running');
      return;
    }

    try {
      // Initialize with current state
      await this.syncCurrentState();

      // Start polling
      this.isPolling = true;
      this.pollInterval = setInterval(async () => {
        try {
          await this.pollForChanges();
        } catch (error) {
          logger.error('Error during polling:', error);
        }
      }, this.pollIntervalMs);

      logger.info(`Polling service started with ${this.pollIntervalMs}ms interval`);
    } catch (error) {
      logger.error('Failed to start polling service:', error);
      this.isPolling = false;
    }
  }

  async stop(): Promise<void> {
    if (!this.isPolling) {
      return;
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.isPolling = false;
    logger.info('Polling service stopped');
  }

  private async syncCurrentState(): Promise<void> {
    try {
      const response = await fetch(`${this.expressServerUrl}/api/elements`);
      if (!response.ok) {
        throw new Error(`Failed to fetch elements: ${response.status}`);
      }

      const data = await response.json() as ApiResponse;
      const elements = data.elements || [];

      // Update last known state
      this.lastKnownState.clear();
      elements.forEach(element => {
        this.lastKnownState.set(element.id, element);
      });

      // Store in Redis
      await redisMemory.storeDiagramState(elements);

      logger.debug(`Synced current state: ${elements.length} elements`);
    } catch (error) {
      logger.error('Error syncing current state:', error);
    }
  }

  private async pollForChanges(): Promise<void> {
    try {
      // Fetch current state from Express server
      const response = await fetch(`${this.expressServerUrl}/api/elements`);
      if (!response.ok) {
        logger.warn(`Failed to fetch elements for polling: ${response.status}`);
        return;
      }

      const data = await response.json() as ApiResponse;
      const currentElements = data.elements || [];

      // Convert to map for easier comparison
      const currentState = new Map<string, ServerElement>();
      currentElements.forEach(element => {
        currentState.set(element.id, element);
      });

      // Detect changes
      const changes: DiagramChange[] = [];
      const timestamp = new Date().toISOString();

      // Check for new or updated elements
      for (const [id, currentElement] of currentState.entries()) {
        const lastKnownElement = this.lastKnownState.get(id);

        if (!lastKnownElement) {
          // New element
          changes.push({
            type: 'created',
            timestamp,
            elementId: id,
            element: currentElement
          });
        } else if (this.hasElementChanged(lastKnownElement, currentElement)) {
          // Updated element
          changes.push({
            type: 'updated',
            timestamp,
            elementId: id,
            element: currentElement
          });
        }
      }

      // Check for deleted elements
      for (const [id, lastElement] of this.lastKnownState.entries()) {
        if (!currentState.has(id)) {
          changes.push({
            type: 'deleted',
            timestamp,
            elementId: id,
            element: lastElement
          });
        }
      }

      // Log changes and update Redis incrementally
      if (changes.length > 0) {
        logger.info(`Detected ${changes.length} changes via polling`);

        // Process changes efficiently
        const elementsToStore: ServerElement[] = [];
        const elementsToDelete: string[] = [];

        for (const change of changes) {
          // Log each change to Redis
          await redisMemory.logChange(change);

          // Collect elements for batch operations
          if (change.type === 'created' || change.type === 'updated') {
            if (change.element) {
              elementsToStore.push(change.element);
            }
          } else if (change.type === 'deleted' && change.elementId) {
            elementsToDelete.push(change.elementId);
          }
        }

        // Batch update Redis efficiently
        if (elementsToStore.length > 0) {
          await redisMemory.storeElements(elementsToStore);
        }
        if (elementsToDelete.length > 0) {
          await redisMemory.removeElements(elementsToDelete);
        }

        // Update diagram state metadata (without forcing full element refresh)
        await redisMemory.storeDiagramState(currentElements, false);

        // Update last known state
        this.lastKnownState = currentState;
      }

    } catch (error) {
      logger.error('Error polling for changes:', error);
    }
  }

  private hasElementChanged(lastElement: ServerElement, currentElement: ServerElement): boolean {
    // Compare key properties to detect changes
    const compareProps = [
      'x', 'y', 'width', 'height', 'text', 'backgroundColor', 'strokeColor',
      'strokeWidth', 'opacity', 'locked', 'updatedAt', 'version'
    ];

    for (const prop of compareProps) {
      if ((lastElement as any)[prop] !== (currentElement as any)[prop]) {
        return true;
      }
    }

    // Compare arrays/objects
    const lastGroupIds = JSON.stringify(lastElement.groupIds || []);
    const currentGroupIds = JSON.stringify(currentElement.groupIds || []);
    if (lastGroupIds !== currentGroupIds) {
      return true;
    }

    const lastLabel = JSON.stringify(lastElement.label || {});
    const currentLabel = JSON.stringify(currentElement.label || {});
    if (lastLabel !== currentLabel) {
      return true;
    }

    return false;
  }

  isRunning(): boolean {
    return this.isPolling;
  }

  getStats(): {
    isRunning: boolean;
    intervalMs: number;
    trackedElements: number;
  } {
    return {
      isRunning: this.isPolling,
      intervalMs: this.pollIntervalMs,
      trackedElements: this.lastKnownState.size
    };
  }
}

// Singleton instance
export const pollingService = new PollingService();