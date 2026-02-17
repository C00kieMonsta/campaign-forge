/**
 * Fake Persistence Service Provider for Testing
 *
 * Provides a test-friendly version of PersistenceServiceProvider that wires
 * fake implementations with real repositories for deterministic testing.
 *
 * Requirements: 17.3, 17.5, 19.1
 */

import type { Store } from "@reduxjs/toolkit";
import {
  ClientRepository,
  ExtractionJobRepository,
  ExtractionResultRepository,
  ProjectRepository,
  type HotRepositoryDependencies,
  type RepositoryDependencies
} from "../repositories";
import { createAppStore, type RootState } from "../store/store";
import {
  FakeDatabaseAdapter,
  type FakeDatabaseAdapterConfig,
  type FakeDatabaseSeedData
} from "./fake-database-adapter";
import {
  FakeWebSocketService,
  type FakeWebSocketServiceConfig
} from "./fake-websocket-service";

/**
 * Configuration for FakePersistenceServiceProvider
 */
export interface FakePersistenceServiceProviderConfig {
  /**
   * Seed data for the fake database
   */
  seedData?: FakeDatabaseSeedData;

  /**
   * Configuration for the fake database adapter
   */
  databaseConfig?: Omit<FakeDatabaseAdapterConfig, "seedData">;

  /**
   * Configuration for the fake WebSocket service
   */
  websocketConfig?: FakeWebSocketServiceConfig;

  /**
   * Optional existing store instance (creates new one if not provided)
   */
  store?: Store<RootState>;
}

/**
 * FakePersistenceServiceProvider Implementation
 *
 * Provides a complete test environment with:
 * - Fresh Redux store instance
 * - FakeDatabaseAdapter with in-memory storage
 * - FakeWebSocketService with manual event triggering
 * - Real repository implementations wired with fakes
 *
 * Requirement 17.3: WHEN tests are written THEN the system SHALL provide
 * a FakePersistenceServiceProvider that wires fakes with real repositories
 *
 * Requirement 17.5: WHEN tests run THEN the system SHALL use real repository
 * logic with fake services for deterministic behavior
 *
 * @example
 * ```typescript
 * // Create provider with seed data
 * const provider = new FakePersistenceServiceProvider({
 *   seedData: {
 *     clients: [
 *       { id: 'client-1', name: 'Test Client', organizationId: 'org-1' }
 *     ]
 *   }
 * });
 *
 * // Use real repository with fake backend
 * const clients = await provider.clients.getAll();
 * expect(clients).toHaveLength(1);
 *
 * // Verify store was hydrated
 * const state = provider.store.getState();
 * expect(state.entities.clients['client-1']).toBeDefined();
 *
 * // Test WebSocket updates
 * provider.fakeWebSocket.emitUpdate('extraction_jobs', {
 *   id: 'job-1',
 *   status: 'completed'
 * });
 * ```
 */
export class FakePersistenceServiceProvider {
  /**
   * The Redux store instance
   */
  public readonly store: Store<RootState>;

  /**
   * The fake database adapter (exposed for test assertions and manipulation)
   */
  public readonly fakeDatabase: FakeDatabaseAdapter;

  /**
   * The fake WebSocket service (exposed for test assertions and event triggering)
   */
  public readonly fakeWebSocket: FakeWebSocketService;

  // Cached repository instances
  private _clientRepository: ClientRepository | null = null;
  private _projectRepository: ProjectRepository | null = null;
  private _extractionJobRepository: ExtractionJobRepository | null = null;
  private _extractionResultRepository: ExtractionResultRepository | null = null;

  constructor(config: FakePersistenceServiceProviderConfig = {}) {
    // Create or use provided store
    this.store = config.store ?? createAppStore();

    // Create fake database with seed data
    this.fakeDatabase = new FakeDatabaseAdapter({
      ...config.databaseConfig,
      seedData: config.seedData
    });

    // Create fake WebSocket service
    this.fakeWebSocket = new FakeWebSocketService(config.websocketConfig);
  }

  /**
   * Get dependencies for cold repositories
   */
  private getColdDependencies(): RepositoryDependencies {
    return {
      store: this.store,
      adapter: this.fakeDatabase
    };
  }

  /**
   * Get dependencies for hot repositories
   */
  private getHotDependencies(): HotRepositoryDependencies {
    return {
      store: this.store,
      adapter: this.fakeDatabase,
      wsService: this.fakeWebSocket
    };
  }

  // ============================================================================
  // Repository Getters
  // ============================================================================

  /**
   * Get the ClientRepository instance (cold data)
   *
   * Requirement 19.1: WHEN a repository test runs THEN the system SHALL use
   * FakeDatabaseAdapter and a fresh store instance
   */
  get clients(): ClientRepository {
    if (!this._clientRepository) {
      this._clientRepository = new ClientRepository(this.getColdDependencies());
    }
    return this._clientRepository;
  }

  /**
   * Get the ProjectRepository instance (cold data)
   */
  get projects(): ProjectRepository {
    if (!this._projectRepository) {
      this._projectRepository = new ProjectRepository(
        this.getColdDependencies()
      );
    }
    return this._projectRepository;
  }

  /**
   * Get the ExtractionJobRepository instance (hot data)
   */
  get extractionJobs(): ExtractionJobRepository {
    if (!this._extractionJobRepository) {
      this._extractionJobRepository = new ExtractionJobRepository(
        this.getHotDependencies()
      );
    }
    return this._extractionJobRepository;
  }

  /**
   * Get the ExtractionResultRepository instance (hot data)
   */
  get extractionResults(): ExtractionResultRepository {
    if (!this._extractionResultRepository) {
      this._extractionResultRepository = new ExtractionResultRepository(
        this.getHotDependencies()
      );
    }
    return this._extractionResultRepository;
  }

  // ============================================================================
  // Test Helper Methods
  // ============================================================================

  /**
   * Reset all state for test isolation
   *
   * Clears the fake database, resets WebSocket service, and creates a new store.
   * Note: After calling reset(), you should create a new provider instance
   * or re-seed the database.
   */
  reset(): void {
    // Clean up hot repositories' WebSocket subscriptions
    this._extractionJobRepository?.destroy();
    this._extractionResultRepository?.destroy();

    // Clear cached repositories
    this._clientRepository = null;
    this._projectRepository = null;
    this._extractionJobRepository = null;
    this._extractionResultRepository = null;

    // Reset fakes
    this.fakeDatabase.clear();
    this.fakeWebSocket.reset();
  }

  /**
   * Seed the database with additional data
   *
   * @param data - Additional seed data to add
   */
  seed(data: FakeDatabaseSeedData): void {
    this.fakeDatabase.seed(data);
  }

  /**
   * Get the current store state
   */
  getState(): RootState {
    return this.store.getState();
  }

  /**
   * Get entities from the store by type
   */
  getEntitiesFromStore<K extends keyof RootState["entities"]>(
    entityType: K
  ): RootState["entities"][K] {
    return this.store.getState().entities[entityType];
  }

  /**
   * Get a single entity from the store
   */
  getEntityFromStore<K extends keyof RootState["entities"]>(
    entityType: K,
    id: string
  ): RootState["entities"][K][string] | undefined {
    const entities = this.store.getState().entities[entityType];
    return (entities as Record<string, any>)[id];
  }

  /**
   * Destroy the provider and clean up resources
   */
  destroy(): void {
    this._extractionJobRepository?.destroy();
    this._extractionResultRepository?.destroy();
  }
}

/**
 * Create a FakePersistenceServiceProvider with common test defaults
 *
 * @param seedData - Optional seed data for the fake database
 * @returns Configured FakePersistenceServiceProvider instance
 */
export function createTestProvider(
  seedData?: FakeDatabaseSeedData
): FakePersistenceServiceProvider {
  return new FakePersistenceServiceProvider({ seedData });
}
