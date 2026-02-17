/**
 * Base Repository Abstractions
 *
 * Defines the core repository interfaces and abstract base class for data access.
 * Repositories encapsulate data fetching, caching, and store hydration logic.
 *
 * Requirements: 3.1, 3.2, 3.3, 15.3, 16.2
 */

import type { IDatabaseAdapter } from "@packages/types";
import type { Store } from "@reduxjs/toolkit";
import type { RootState } from "../store/store";

/**
 * Base entity interface - all entities must have an id
 */
export interface BaseEntity {
  id: string;
}

/**
 * Generic Repository interface defining CRUD operations
 *
 * All repositories implement this interface to provide consistent
 * data access patterns across the application.
 */
export interface IRepository<T extends BaseEntity> {
  /**
   * Fetch a single entity by ID
   * @param id - Entity identifier
   * @returns Promise resolving to entity or null if not found
   */
  getById(id: string): Promise<T | null>;

  /**
   * Fetch all entities with optional filtering
   * @param filters - Optional filter criteria
   * @returns Promise resolving to array of entities
   */
  getAll(filters?: Record<string, any>): Promise<T[]>;

  /**
   * Create a new entity
   * @param data - Entity data without ID
   * @returns Promise resolving to created entity
   */
  create(data: Omit<T, "id">): Promise<T>;

  /**
   * Update an existing entity
   * @param id - Entity identifier
   * @param data - Partial entity data to update
   * @returns Promise resolving to updated entity
   */
  update(id: string, data: Partial<T>): Promise<T>;

  /**
   * Delete an entity
   * @param id - Entity identifier
   * @returns Promise resolving when deletion is complete
   */
  delete(id: string): Promise<void>;

  /**
   * Perform an optimistic update with automatic rollback on failure
   * @param id - Entity identifier
   * @param data - Partial entity data to update
   * @returns Promise resolving to updated entity
   */
  updateOptimistic(id: string, data: Partial<T>): Promise<T>;
}

/**
 * Cold Repository interface for infrequently changing data
 *
 * Cold repositories use longer cache TTLs and do not subscribe to WebSocket updates.
 * Examples: Clients, Projects, Organizations
 */
export interface IColdRepository<T extends BaseEntity> extends IRepository<T> {
  /**
   * Cache TTL in seconds for cold data
   * Default: 300 seconds (5 minutes)
   */
  readonly cacheTTL: number;
}

/**
 * Hot Repository interface for frequently changing data
 *
 * Hot repositories use short cache TTLs and subscribe to WebSocket channels
 * for realtime updates.
 * Examples: ExtractionJobs, ExtractionResults
 */
export interface IHotRepository<T extends BaseEntity> extends IRepository<T> {
  /**
   * Cache TTL in seconds for hot data
   * Default: 30 seconds
   */
  readonly cacheTTL: number;

  /**
   * Subscribe to WebSocket channel for realtime updates
   */
  subscribe(): void;

  /**
   * Unsubscribe from WebSocket channel
   */
  unsubscribe(): void;

  /**
   * Check if repository is currently subscribed to WebSocket updates
   */
  isSubscribed(): boolean;
}

/**
 * Repository dependencies injected by PersistenceServiceProvider
 */
export interface RepositoryDependencies {
  store: Store<RootState>;
  adapter: IDatabaseAdapter;
  queryClient?: any; // Optional TanStack Query client
}

/**
 * Extended dependencies for hot repositories that require WebSocket service
 */
export interface HotRepositoryDependencies extends RepositoryDependencies {
  wsService: any; // IWebSocketService - using any to avoid circular dependency
}

/**
 * Abstract base repository class with common CRUD operations
 *
 * Provides shared functionality for all repositories including:
 * - Store hydration after fetch operations
 * - Optimistic updates with rollback
 * - Error handling and logging
 * - Normalization utilities
 */
export abstract class BaseRepository<T extends BaseEntity>
  implements IRepository<T>
{
  protected readonly store: Store<RootState>;
  protected readonly adapter: IDatabaseAdapter;
  protected readonly queryClient?: any;

  constructor(dependencies: RepositoryDependencies) {
    this.store = dependencies.store;
    this.adapter = dependencies.adapter;
    this.queryClient = dependencies.queryClient;
  }

  /**
   * Get the base API path for this repository
   * Must be implemented by concrete repositories
   */
  protected abstract getBasePath(): string;

  /**
   * Get the entity type name for store operations
   * Must be implemented by concrete repositories
   */
  protected abstract getEntityType(): keyof RootState["entities"];

  /**
   * Normalize a single entity for store storage
   * Can be overridden by concrete repositories for custom normalization
   */
  protected normalizeEntity(entity: T): T {
    return entity;
  }

  /**
   * Normalize an array of entities for store storage
   * Can be overridden by concrete repositories for custom normalization
   */
  protected normalizeEntities(entities: T[]): T[] {
    return entities.map((entity) => this.normalizeEntity(entity));
  }

  /**
   * Hydrate the store with a single entity
   */
  protected hydrateEntity(entity: T): void {
    const normalized = this.normalizeEntity(entity);
    const entityType = this.getEntityType();

    // Dispatch action to update store based on entity type
    // This will be implemented by concrete repositories using slice actions
    this.dispatchSetEntity(entityType, normalized);
  }

  /**
   * Hydrate the store with multiple entities
   */
  protected hydrateEntities(entities: T[]): void {
    const normalized = this.normalizeEntities(entities);
    const entityType = this.getEntityType();

    // Dispatch action to update store based on entity type
    this.dispatchSetEntities(entityType, normalized);
  }

  /**
   * Dispatch action to set a single entity in the store
   * Must be implemented by concrete repositories
   */
  protected abstract dispatchSetEntity(
    entityType: keyof RootState["entities"],
    entity: T
  ): void;

  /**
   * Dispatch action to set multiple entities in the store
   * Must be implemented by concrete repositories
   */
  protected abstract dispatchSetEntities(
    entityType: keyof RootState["entities"],
    entities: T[]
  ): void;

  /**
   * Dispatch action to remove an entity from the store
   * Must be implemented by concrete repositories
   */
  protected abstract dispatchRemoveEntity(
    entityType: keyof RootState["entities"],
    id: string
  ): void;

  /**
   * Dispatch action to set error state in the UI slice
   * Can be overridden by concrete repositories to write error state
   * @param error - Error message to set, or null to clear
   */
  protected dispatchSetError(error: string | null): void {
    // Default implementation does nothing
    // Concrete repositories can override to dispatch error state to UI slice
  }

  /**
   * Get entity from store by ID
   */
  protected getEntityFromStore(id: string): T | null {
    const state = this.store.getState();
    const entityType = this.getEntityType();
    const entities = state.entities[entityType] as unknown as Record<string, T>;
    return entities[id] || null;
  }

  /**
   * Default implementation of getById
   * Fetches from backend and hydrates store
   */
  async getById(id: string): Promise<T | null> {
    try {
      const entity = await this.adapter.get<T>(`${this.getBasePath()}/${id}`);
      if (entity) {
        this.hydrateEntity(entity);
      }
      return entity;
    } catch (error) {
      console.error(`Error fetching entity ${id}:`, error);
      throw error;
    }
  }

  /**
   * Default implementation of getAll
   * Fetches from backend and hydrates store
   */
  async getAll(filters?: Record<string, any>): Promise<T[]> {
    try {
      const entities = await this.adapter.get<T[]>(this.getBasePath(), filters);
      this.hydrateEntities(entities);
      return entities;
    } catch (error) {
      console.error("Error fetching entities:", error);
      throw error;
    }
  }

  /**
   * Default implementation of create
   * Creates entity on backend and hydrates store
   */
  async create(data: Omit<T, "id">): Promise<T> {
    try {
      const entity = await this.adapter.post<T>(this.getBasePath(), data);
      this.hydrateEntity(entity);
      return entity;
    } catch (error) {
      console.error("Error creating entity:", error);
      throw error;
    }
  }

  /**
   * Default implementation of update
   * Updates entity on backend and hydrates store
   */
  async update(id: string, data: Partial<T>): Promise<T> {
    try {
      const entity = await this.adapter.patch<T>(
        `${this.getBasePath()}/${id}`,
        data
      );
      this.hydrateEntity(entity);
      return entity;
    } catch (error) {
      console.error(`Error updating entity ${id}:`, error);
      throw error;
    }
  }

  /**
   * Default implementation of delete
   * Deletes entity on backend and removes from store
   */
  async delete(id: string): Promise<void> {
    try {
      await this.adapter.delete(`${this.getBasePath()}/${id}`);
      const entityType = this.getEntityType();
      this.dispatchRemoveEntity(entityType, id);
    } catch (error) {
      console.error(`Error deleting entity ${id}:`, error);
      throw error;
    }
  }

  /**
   * Optimistic update implementation
   * Immediately updates store, then syncs with backend
   * Rolls back on failure and optionally writes error state to UI slice
   *
   * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 20.5
   */
  async updateOptimistic(id: string, data: Partial<T>): Promise<T> {
    // 1. Read current entity from store (Requirement 7.1)
    const currentEntity = this.getEntityFromStore(id);
    if (!currentEntity) {
      throw new Error(`Entity ${id} not found in store for optimistic update`);
    }

    // 2. Create optimistic version
    const optimisticEntity = {
      ...currentEntity,
      ...data
    };

    // 3. Immediately update store (Requirement 7.2)
    this.hydrateEntity(optimisticEntity);

    // Clear any previous error state
    this.dispatchSetError(null);

    try {
      // 4. Perform HTTP request
      const serverEntity = await this.adapter.patch<T>(
        `${this.getBasePath()}/${id}`,
        data
      );

      // 5. Replace optimistic version with server response (Requirement 7.3)
      this.hydrateEntity(serverEntity);

      return serverEntity;
    } catch (error) {
      // 6. Rollback to previous state on failure (Requirement 7.4)
      console.error(
        `Optimistic update failed for entity ${id}, rolling back:`,
        error
      );
      this.hydrateEntity(currentEntity);

      // 7. Write error state to UI slice (Requirement 7.5, 20.5)
      const errorMessage =
        error instanceof Error ? error.message : "Update failed";
      this.dispatchSetError(errorMessage);

      throw error;
    }
  }
}
