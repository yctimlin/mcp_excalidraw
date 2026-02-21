import { createClient, RedisClientType } from 'redis';
import logger from '../utils/logger.js';
import { ServerElement } from '../types.js';

export interface DiagramChange {
  type: 'created' | 'updated' | 'deleted' | 'batch_created' | 'cleared';
  timestamp: string;
  elementId?: string;
  elementIds?: string[];
  element?: ServerElement;
  elements?: ServerElement[];
  changeCount?: number;
}

export interface DiagramState {
  elements: ServerElement[];
  lastUpdated: string;
  elementCount: number;
}

export class RedisMemoryService {
  private client: RedisClientType;
  private isConnected = false;

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        connectTimeout: 5000
      }
    });

    this.client.on('error', (err) => {
      logger.error('Redis client error:', err);
      this.isConnected = false;
    });

    this.client.on('connect', () => {
      logger.info('Connected to Redis');
      this.isConnected = true;
    });

    this.client.on('disconnect', () => {
      logger.warn('Disconnected from Redis');
      this.isConnected = false;
    });
  }

  async connect(): Promise<void> {
    if (!this.isConnected) {
      try {
        await this.client.connect();
        this.isConnected = true;
        logger.info('Redis memory service connected');
      } catch (error) {
        logger.error('Failed to connect to Redis:', error);
        this.isConnected = false;
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      try {
        await this.client.disconnect();
        this.isConnected = false;
        logger.info('Redis memory service disconnected');
      } catch (error) {
        logger.error('Error disconnecting from Redis:', error);
      }
    }
  }

  private async ensureConnected(): Promise<boolean> {
    if (!this.isConnected) {
      await this.connect();
    }
    return this.isConnected;
  }

  // Store current diagram state
  async storeDiagramState(elements: ServerElement[]): Promise<void> {
    if (!await this.ensureConnected()) {
      logger.warn('Redis not connected, skipping state storage');
      return;
    }

    try {
      const state: DiagramState = {
        elements,
        lastUpdated: new Date().toISOString(),
        elementCount: elements.length
      };

      await this.client.set('diagram:current', JSON.stringify(state));

      // Also store individual elements for quick lookups
      const pipeline = this.client.multi();

      // Clear existing element keys first
      const existingKeys = await this.client.keys('diagram:element:*');
      if (existingKeys.length > 0) {
        pipeline.del(existingKeys);
      }

      // Store new elements
      elements.forEach(element => {
        pipeline.set(`diagram:element:${element.id}`, JSON.stringify(element));
      });

      await pipeline.exec();

      logger.debug(`Stored diagram state with ${elements.length} elements`);
    } catch (error) {
      logger.error('Error storing diagram state:', error);
    }
  }

  // Get current diagram state
  async getDiagramState(): Promise<DiagramState | null> {
    if (!await this.ensureConnected()) {
      logger.warn('Redis not connected, returning null state');
      return null;
    }

    try {
      const stateStr = await this.client.get('diagram:current');
      if (!stateStr) {
        return null;
      }

      const state = JSON.parse(stateStr) as DiagramState;
      return state;
    } catch (error) {
      logger.error('Error getting diagram state:', error);
      return null;
    }
  }

  // Get specific element
  async getElement(elementId: string): Promise<ServerElement | null> {
    if (!await this.ensureConnected()) {
      return null;
    }

    try {
      const elementStr = await this.client.get(`diagram:element:${elementId}`);
      if (!elementStr) {
        return null;
      }

      return JSON.parse(elementStr) as ServerElement;
    } catch (error) {
      logger.error('Error getting element:', error);
      return null;
    }
  }

  // Log a change event
  async logChange(change: DiagramChange): Promise<void> {
    if (!await this.ensureConnected()) {
      logger.warn('Redis not connected, skipping change log');
      return;
    }

    try {
      const changeStr = JSON.stringify(change);

      // Add to changes list (keep last 1000 changes)
      await this.client.lPush('diagram:changes', changeStr);
      await this.client.lTrim('diagram:changes', 0, 999);

      logger.debug(`Logged change: ${change.type}`, {
        elementId: change.elementId,
        elementIds: change.elementIds?.length
      });
    } catch (error) {
      logger.error('Error logging change:', error);
    }
  }

  // Get recent changes
  async getRecentChanges(limit: number = 10): Promise<DiagramChange[]> {
    if (!await this.ensureConnected()) {
      return [];
    }

    try {
      const changesStr = await this.client.lRange('diagram:changes', 0, limit - 1);
      return changesStr.map(str => JSON.parse(str) as DiagramChange);
    } catch (error) {
      logger.error('Error getting recent changes:', error);
      return [];
    }
  }

  // Get changes since timestamp
  async getChangesSince(timestamp: string): Promise<DiagramChange[]> {
    if (!await this.ensureConnected()) {
      return [];
    }

    try {
      const allChanges = await this.client.lRange('diagram:changes', 0, -1);
      const parsedChanges = allChanges.map(str => JSON.parse(str) as DiagramChange);

      return parsedChanges.filter(change => change.timestamp > timestamp);
    } catch (error) {
      logger.error('Error getting changes since timestamp:', error);
      return [];
    }
  }

  // Clear all memory
  async clearMemory(): Promise<void> {
    if (!await this.ensureConnected()) {
      return;
    }

    try {
      const keys = await this.client.keys('diagram:*');
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      logger.info('Cleared all diagram memory');
    } catch (error) {
      logger.error('Error clearing memory:', error);
    }
  }

  // Get memory stats
  async getMemoryStats(): Promise<{
    elementCount: number;
    changeCount: number;
    lastUpdated: string | null;
    memorySize: number;
  }> {
    if (!await this.ensureConnected()) {
      return {
        elementCount: 0,
        changeCount: 0,
        lastUpdated: null,
        memorySize: 0
      };
    }

    try {
      const state = await this.getDiagramState();
      const changeCount = await this.client.lLen('diagram:changes');
      const memoryInfo = await this.client.memoryUsage('diagram:current') || 0;

      return {
        elementCount: state?.elementCount || 0,
        changeCount: changeCount || 0,
        lastUpdated: state?.lastUpdated || null,
        memorySize: memoryInfo
      };
    } catch (error) {
      logger.error('Error getting memory stats:', error);
      return {
        elementCount: 0,
        changeCount: 0,
        lastUpdated: null,
        memorySize: 0
      };
    }
  }

  // Check if connected
  isRedisConnected(): boolean {
    return this.isConnected;
  }
}

// Singleton instance
export const redisMemory = new RedisMemoryService();