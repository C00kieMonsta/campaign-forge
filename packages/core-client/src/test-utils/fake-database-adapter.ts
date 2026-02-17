/**
 * Fake Database Adapter for Testing
 *
 * Provides an in-memory implementation of IDatabaseAdapter for testing
 * repositories without hitting the backend.
 *
 * Requirements: 17.1, 17.4, 18.1, 18.2, 18.3, 18.4, 18.5
 */

import {
  IDatabaseAdapter,
  NotFoundError,
  ValidationError
} from "@packages/types";

/**
 * Entity with ID for storage
 */
interface StoredEntity {
  id: string;
  [key: string]: any;
}

/**
 * Seed data structure for initializing the fake database
 */
export interface FakeDatabaseSeedData {
  clients?: StoredEntity[];
  projects?: StoredEntity[];
  extractionJobs?: StoredEntity[];
  extractionResults?: StoredEntity[];
  extractionSchemas?: StoredEntity[];
  suppliers?: StoredEntity[];
  [key: string]: StoredEntity[] | undefined;
}

/**
 * Configuration for FakeDatabaseAdapter
 */
export interface FakeDatabaseAdapterConfig {
  /**
   * Initial seed data to populate the database
   */
  seedData?: FakeDatabaseSeedData;

  /**
   * Simulate network latency in milliseconds
   * @default 0
   */
  latency?: number;

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;
}

/**
 * FakeDatabaseAdapter Implementation
 *
 * Provides an in-memory database for testing that:
 * - Stores entities by collection and ID
 * - Supports seeding with test data
 * - Simulates CRUD operations
 * - Can simulate network latency
 * - Supports clearing for test isolation
 */
export class FakeDatabaseAdapter implements IDatabaseAdapter {
  private storage: Map<string, Map<string, StoredEntity>> = new Map();
  private readonly latency: number;
  private readonly debug: boolean;
  private idCounter: number = 1;

  constructor(config: FakeDatabaseAdapterConfig = {}) {
    this.latency = config.latency ?? 0;
    this.debug = config.debug ?? false;

    if (config.seedData) {
      this.seed(config.seedData);
    }
  }

  /**
   * Seed the database with initial data
   *
   * Requirement 18.1: WHEN a FakeDatabaseAdapter is created THEN the system
   * SHALL accept a seed object with entity collections
   *
   * Requirement 18.2: WHEN seed data is provided THEN the system SHALL
   * populate the in-memory database with the entities
   */
  seed(data: FakeDatabaseSeedData): void {
    this.log("Seeding database with data:", Object.keys(data));

    Object.entries(data).forEach(([collection, entities]) => {
      if (entities && Array.isArray(entities)) {
        const collectionMap = new Map<string, StoredEntity>();
        entities.forEach((entity) => {
          if (entity.id) {
            collectionMap.set(entity.id, { ...entity });
          }
        });
        this.storage.set(collection, collectionMap);
      }
    });
  }

  /**
   * Clear all data from the database
   *
   * Requirement 18.5: WHEN tests complete THEN the system SHALL allow
   * clearing the fake database for test isolation
   */
  clear(): void {
    this.log("Clearing database");
    this.storage.clear();
    this.idCounter = 1;
  }

  /**
   * Clear a specific collection
   */
  clearCollection(collection: string): void {
    this.log(`Clearing collection: ${collection}`);
    this.storage.delete(collection);
  }

  /**
   * Get all entities in a collection (for testing assertions)
   */
  getCollection(collection: string): StoredEntity[] {
    const collectionMap = this.storage.get(collection);
    return collectionMap ? Array.from(collectionMap.values()) : [];
  }

  /**
   * Get a single entity by collection and ID (for testing assertions)
   */
  getEntity(collection: string, id: string): StoredEntity | undefined {
    return this.storage.get(collection)?.get(id);
  }

  /**
   * Perform a GET request
   *
   * Requirement 18.3: WHEN repositories query the fake database THEN the
   * system SHALL return seeded entities
   */
  async get<T>(path: string, params?: Record<string, any>): Promise<T> {
    await this.simulateLatency();
    this.log(`GET ${path}`, params);

    const { collection, id } = this.parsePath(path);
    const collectionMap = this.getOrCreateCollection(collection);

    if (id) {
      // Get single entity
      const entity = collectionMap.get(id);
      if (!entity) {
        throw new NotFoundError(`Entity not found: ${collection}/${id}`);
      }
      return entity as T;
    }

    // Get all entities with optional filtering
    let entities = Array.from(collectionMap.values());

    // Requirement 18.4: WHEN repositories filter data THEN the system
    // SHALL apply filters to seeded entities
    if (params) {
      entities = this.applyFilters(entities, params);
    }

    return entities as T;
  }

  /**
   * Perform a POST request (create)
   */
  async post<T>(path: string, data?: any): Promise<T> {
    await this.simulateLatency();
    this.log(`POST ${path}`, data);

    const { collection } = this.parsePath(path);
    const collectionMap = this.getOrCreateCollection(collection);

    // Validate required data
    if (!data) {
      throw new ValidationError("Request body is required");
    }

    // Generate ID if not provided
    const id = data.id || this.generateId();
    const now = new Date();

    const entity: StoredEntity = {
      ...data,
      id,
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now
    };

    collectionMap.set(id, entity);
    return entity as T;
  }

  /**
   * Perform a PUT request (full update)
   */
  async put<T>(path: string, data?: any): Promise<T> {
    await this.simulateLatency();
    this.log(`PUT ${path}`, data);

    const { collection, id } = this.parsePath(path);

    if (!id) {
      throw new ValidationError("Entity ID is required for PUT");
    }

    const collectionMap = this.getOrCreateCollection(collection);
    const existing = collectionMap.get(id);

    if (!existing) {
      throw new NotFoundError(`Entity not found: ${collection}/${id}`);
    }

    const entity: StoredEntity = {
      ...data,
      id,
      createdAt: existing.createdAt,
      updatedAt: new Date()
    };

    collectionMap.set(id, entity);
    return entity as T;
  }

  /**
   * Perform a PATCH request (partial update)
   */
  async patch<T>(path: string, data?: any): Promise<T> {
    await this.simulateLatency();
    this.log(`PATCH ${path}`, data);

    const { collection, id } = this.parsePath(path);

    if (!id) {
      throw new ValidationError("Entity ID is required for PATCH");
    }

    const collectionMap = this.getOrCreateCollection(collection);
    const existing = collectionMap.get(id);

    if (!existing) {
      throw new NotFoundError(`Entity not found: ${collection}/${id}`);
    }

    const entity: StoredEntity = {
      ...existing,
      ...data,
      id,
      updatedAt: new Date()
    };

    collectionMap.set(id, entity);
    return entity as T;
  }

  /**
   * Perform a DELETE request
   */
  async delete<T>(path: string): Promise<T> {
    await this.simulateLatency();
    this.log(`DELETE ${path}`);

    const { collection, id } = this.parsePath(path);

    if (!id) {
      throw new ValidationError("Entity ID is required for DELETE");
    }

    const collectionMap = this.getOrCreateCollection(collection);
    const existing = collectionMap.get(id);

    if (!existing) {
      throw new NotFoundError(`Entity not found: ${collection}/${id}`);
    }

    collectionMap.delete(id);
    return undefined as T;
  }

  /**
   * Parse API path to extract collection and optional ID
   * Handles paths like:
   * - /api/clients -> { collection: 'clients', id: undefined }
   * - /api/clients/123 -> { collection: 'clients', id: '123' }
   * - /clients -> { collection: 'clients', id: undefined }
   * - /clients/123 -> { collection: 'clients', id: '123' }
   */
  private parsePath(path: string): { collection: string; id?: string } {
    // Remove /api prefix if present
    let normalizedPath = path.replace(/^\/api/, "");
    // Remove leading slash
    normalizedPath = normalizedPath.replace(/^\//, "");

    const parts = normalizedPath.split("/").filter(Boolean);

    if (parts.length === 0) {
      throw new ValidationError("Invalid path: collection name required");
    }

    return {
      collection: parts[0],
      id: parts[1]
    };
  }

  /**
   * Get or create a collection map
   */
  private getOrCreateCollection(name: string): Map<string, StoredEntity> {
    if (!this.storage.has(name)) {
      this.storage.set(name, new Map());
    }
    return this.storage.get(name)!;
  }

  /**
   * Apply filters to entities
   */
  private applyFilters(
    entities: StoredEntity[],
    filters: Record<string, any>
  ): StoredEntity[] {
    return entities.filter((entity) => {
      return Object.entries(filters).every(([key, value]) => {
        if (value === undefined || value === null) {
          return true;
        }

        const entityValue = entity[key];

        // Handle array values (e.g., status in ['active', 'pending'])
        if (Array.isArray(value)) {
          return value.includes(entityValue);
        }

        // Handle string search (case-insensitive contains)
        if (
          typeof value === "string" &&
          typeof entityValue === "string" &&
          key.toLowerCase().includes("search")
        ) {
          return entityValue.toLowerCase().includes(value.toLowerCase());
        }

        // Exact match
        return entityValue === value;
      });
    });
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `fake-${this.idCounter++}`;
  }

  /**
   * Simulate network latency
   */
  private async simulateLatency(): Promise<void> {
    if (this.latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latency));
    }
  }

  /**
   * Log debug messages
   */
  private log(message: string, ...args: any[]): void {
    if (this.debug) {
      console.log(`[FakeDatabaseAdapter] ${message}`, ...args);
    }
  }
}
