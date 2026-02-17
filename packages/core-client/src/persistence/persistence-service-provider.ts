/**
 * Persistence Service Provider
 *
 * Singleton that provides access to all repositories with injected dependencies.
 * This is the main entry point for data access in the store-first architecture.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 16.2, 16.3
 */

import type { IDatabaseAdapter, IWebSocketService } from "@packages/types";
import type { Store } from "@reduxjs/toolkit";
import type { QueryClient } from "@tanstack/react-query";
import {
  ClientRepository,
  DataLayerRepository,
  ExtractionJobRepository,
  ExtractionResultRepository,
  ExtractionSchemaRepository,
  OrganizationRepository,
  ProjectRepository,
  SupplierRepository,
  type HotRepositoryDependencies,
  type RepositoryDependencies
} from "../repositories";
import type { RootState } from "../store/store";

/**
 * Configuration for initializing the PersistenceServiceProvider
 */
export interface PersistenceServiceProviderConfig {
  /**
   * Redux store instance
   */
  store: Store<RootState>;

  /**
   * Database adapter for HTTP communication
   */
  adapter: IDatabaseAdapter;

  /**
   * WebSocket service for realtime updates
   */
  wsService: IWebSocketService;

  /**
   * Optional TanStack Query client for caching
   */
  queryClient?: QueryClient;
}

/**
 * PersistenceServiceProvider Singleton
 *
 * Provides centralized access to all repositories with properly injected dependencies.
 * Cold repositories (clients, organization) receive store, adapter, and optional queryClient.
 * Hot repositories (projects, dataLayers, extractionSchemas, extractionJobs, extractionResults) additionally receive wsService.
 *
 * Usage:
 * ```typescript
 * // Initialize once at app startup
 * PersistenceServiceProvider.initialize({
 *   store,
 *   adapter,
 *   wsService,
 *   queryClient // optional
 * });
 *
 * // Access repositories anywhere
 * const provider = getPersistenceServiceProvider();
 * const clients = await provider.clients.getAll();
 * ```
 */
export class PersistenceServiceProvider {
  private static instance: PersistenceServiceProvider | null = null;

  private readonly store: Store<RootState>;
  private readonly adapter: IDatabaseAdapter;
  private readonly wsService: IWebSocketService;
  private readonly queryClient?: QueryClient;

  // Cached repository instances
  private _clientRepository: ClientRepository | null = null;
  private _projectRepository: ProjectRepository | null = null;
  private _extractionJobRepository: ExtractionJobRepository | null = null;
  private _extractionResultRepository: ExtractionResultRepository | null = null;
  private _organizationRepository: OrganizationRepository | null = null;
  private _supplierRepository: SupplierRepository | null = null;
  private _dataLayerRepository: DataLayerRepository | null = null;
  private _extractionSchemaRepository: ExtractionSchemaRepository | null = null;

  /**
   * Private constructor - use initialize() to create the singleton
   */
  private constructor(config: PersistenceServiceProviderConfig) {
    this.store = config.store;
    this.adapter = config.adapter;
    this.wsService = config.wsService;
    this.queryClient = config.queryClient;
  }

  /**
   * Initialize the PersistenceServiceProvider singleton
   *
   * Must be called once at application startup before accessing repositories.
   * Throws an error if called more than once.
   *
   * @param config - Configuration with store, adapter, wsService, and optional queryClient
   * @throws Error if already initialized
   *
   * Requirement 9.1: WHEN the application starts THEN the system SHALL initialize
   * the PersistenceServiceProvider as a singleton
   */
  static initialize(config: PersistenceServiceProviderConfig): void {
    if (PersistenceServiceProvider.instance) {
      throw new Error(
        "PersistenceServiceProvider already initialized. Call reset() first if you need to reinitialize."
      );
    }
    PersistenceServiceProvider.instance = new PersistenceServiceProvider(
      config
    );
  }

  /**
   * Get the singleton instance
   *
   * @returns The PersistenceServiceProvider instance
   * @throws Error if not initialized
   */
  static getInstance(): PersistenceServiceProvider {
    if (!PersistenceServiceProvider.instance) {
      throw new Error(
        "PersistenceServiceProvider not initialized. Call PersistenceServiceProvider.initialize() first."
      );
    }
    return PersistenceServiceProvider.instance;
  }

  /**
   * Check if the provider has been initialized
   *
   * @returns true if initialized, false otherwise
   */
  static isInitialized(): boolean {
    return PersistenceServiceProvider.instance !== null;
  }

  /**
   * Reset the singleton instance (primarily for testing)
   *
   * Cleans up any active WebSocket subscriptions before resetting.
   */
  static reset(): void {
    if (PersistenceServiceProvider.instance) {
      PersistenceServiceProvider.instance._extractionJobRepository?.destroy();
      PersistenceServiceProvider.instance._extractionResultRepository?.destroy();
      PersistenceServiceProvider.instance._projectRepository?.destroy();
      PersistenceServiceProvider.instance._dataLayerRepository?.destroy();
      PersistenceServiceProvider.instance._extractionSchemaRepository?.destroy();
      PersistenceServiceProvider.instance = null;
    }
  }

  /**
   * Get dependencies for cold repositories
   *
   * Requirement 9.3: WHEN a cold repository is created THEN the system SHALL
   * inject adapter, store, and optional cache
   */
  private getColdDependencies(): RepositoryDependencies {
    return {
      store: this.store,
      adapter: this.adapter,
      queryClient: this.queryClient
    };
  }

  /**
   * Get dependencies for hot repositories
   *
   * Requirement 9.4: WHEN a hot repository is created THEN the system SHALL
   * inject adapter, store, WebSocket service, and optional cache
   */
  private getHotDependencies(): HotRepositoryDependencies {
    return {
      store: this.store,
      adapter: this.adapter,
      wsService: this.wsService,
      queryClient: this.queryClient
    };
  }

  // ============================================================================
  // Repository Getters
  // Requirement 9.2: WHEN a repository is accessed THEN the system SHALL inject
  // the store, adapter, and appropriate services
  // ============================================================================

  /**
   * Get the ClientRepository instance (cold data)
   *
   * Lazily creates and caches the repository instance.
   */
  get clients(): ClientRepository {
    if (!this._clientRepository) {
      this._clientRepository = new ClientRepository(this.getColdDependencies());
    }
    return this._clientRepository;
  }

  /**
   * Get the ProjectRepository instance (hot data)
   *
   * Lazily creates and caches the repository instance.
   */
  get projects(): ProjectRepository {
    if (!this._projectRepository) {
      this._projectRepository = new ProjectRepository(
        this.getHotDependencies()
      );
    }
    return this._projectRepository;
  }

  /**
   * Get the ExtractionJobRepository instance (hot data)
   *
   * Lazily creates and caches the repository instance.
   * Automatically subscribes to WebSocket channel for realtime updates.
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
   *
   * Lazily creates and caches the repository instance.
   * Automatically subscribes to WebSocket channel for realtime updates.
   */
  get extractionResults(): ExtractionResultRepository {
    if (!this._extractionResultRepository) {
      this._extractionResultRepository = new ExtractionResultRepository(
        this.getHotDependencies()
      );
    }
    return this._extractionResultRepository;
  }

  /**
   * Get the OrganizationRepository instance (cold data)
   *
   * Lazily creates and caches the repository instance.
   */
  get organization(): OrganizationRepository {
    if (!this._organizationRepository) {
      this._organizationRepository = new OrganizationRepository(
        this.getColdDependencies()
      );
    }
    return this._organizationRepository;
  }

  /**
   * Get the SupplierRepository instance (cold data with optional WebSocket support)
   *
   * Lazily creates and caches the repository instance.
   * Uses hot dependencies to enable WebSocket subscription for supplier matches.
   */
  get suppliers(): SupplierRepository {
    if (!this._supplierRepository) {
      this._supplierRepository = new SupplierRepository(
        this.getHotDependencies()
      );
    }
    return this._supplierRepository;
  }

  /**
   * Get the DataLayerRepository instance (hot data)
   *
   * Lazily creates and caches the repository instance.
   */
  get dataLayers(): DataLayerRepository {
    if (!this._dataLayerRepository) {
      this._dataLayerRepository = new DataLayerRepository(
        this.getHotDependencies()
      );
    }
    return this._dataLayerRepository;
  }

  /**
   * Get the ExtractionSchemaRepository instance (hot data)
   *
   * Lazily creates and caches the repository instance.
   */
  get extractionSchemas(): ExtractionSchemaRepository {
    if (!this._extractionSchemaRepository) {
      this._extractionSchemaRepository = new ExtractionSchemaRepository(
        this.getHotDependencies()
      );
    }
    return this._extractionSchemaRepository;
  }
}

/**
 * Convenience function to get the PersistenceServiceProvider instance
 *
 * Requirement 9.5: WHEN components need data access THEN the system SHALL use
 * getPersistenceServiceProvider() to access repositories
 *
 * @returns The PersistenceServiceProvider singleton instance
 * @throws Error if not initialized
 *
 * Usage:
 * ```typescript
 * const provider = getPersistenceServiceProvider();
 * const clients = await provider.clients.getAll();
 * ```
 */
export function getPersistenceServiceProvider(): PersistenceServiceProvider {
  return PersistenceServiceProvider.getInstance();
}
