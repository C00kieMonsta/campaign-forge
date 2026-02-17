/**
 * Client Repository (Cold Data)
 *
 * Manages client data fetching, caching, and store hydration.
 * Clients are cold data - they change infrequently and use longer cache TTLs.
 *
 * Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5
 */

import type {
  Client,
  CreateClientData,
  IClientRepository,
  UpdateClientRequest
} from "@packages/types";
import {
  removeClient,
  setClient,
  setClients
} from "../store/slices/entities-slice";
import { setClientsError } from "../store/slices/ui-slice";
import type { RootState } from "../store/store";
import {
  BaseRepository,
  IColdRepository,
  type RepositoryDependencies
} from "./base-repository";

/**
 * Repository for managing Client entities
 *
 * Implements both the store-first pattern (IColdRepository) and
 * the domain-specific interface (IClientRepository) for:
 * - Optional TanStack Query caching with 300s TTL
 * - Store hydration after all fetch operations
 * - Cache invalidation on mutations
 * - Optimistic updates with rollback
 * - Business-specific operations (pagination, organization filtering)
 */
export class ClientRepository
  extends BaseRepository<Client>
  implements IColdRepository<Client>, IClientRepository
{
  /**
   * Cache TTL for cold data: 300 seconds (5 minutes)
   */
  readonly cacheTTL = 300;

  constructor(dependencies: RepositoryDependencies) {
    super(dependencies);
  }

  /**
   * Get the base API path for client endpoints
   */
  protected getBasePath(): string {
    return "/clients";
  }

  /**
   * Get the entity type name for store operations
   */
  protected getEntityType(): keyof RootState["entities"] {
    return "clients";
  }

  /**
   * Dispatch action to set a single client in the store
   */
  protected dispatchSetEntity(
    _entityType: keyof RootState["entities"],
    entity: Client
  ): void {
    this.store.dispatch(setClient(entity));
  }

  /**
   * Dispatch action to set multiple clients in the store
   */
  protected dispatchSetEntities(
    _entityType: keyof RootState["entities"],
    entities: Client[]
  ): void {
    this.store.dispatch(setClients(entities));
  }

  /**
   * Dispatch action to remove a client from the store
   */
  protected dispatchRemoveEntity(
    _entityType: keyof RootState["entities"],
    id: string
  ): void {
    this.store.dispatch(removeClient(id));
  }

  /**
   * Dispatch action to set error state in the UI slice for clients
   * Called by optimistic update on failure (Requirement 7.5, 20.5)
   */
  protected dispatchSetError(error: string | null): void {
    this.store.dispatch(setClientsError(error));
  }

  /**
   * Fetch a single client by ID with optional caching
   *
   * If queryClient is configured, checks cache before making HTTP request.
   * Always hydrates the store with the result.
   *
   * @param id - Client identifier
   * @returns Promise resolving to client or null if not found
   */
  async getById(id: string): Promise<Client | null> {
    // If queryClient is available, use it for caching
    if (this.queryClient) {
      try {
        const cachedClient = await this.queryClient.fetchQuery({
          queryKey: ["clients", id],
          queryFn: async () => {
            const client = await this.adapter.get<Client>(
              `${this.getBasePath()}/${id}`
            );
            return client;
          },
          staleTime: this.cacheTTL * 1000 // Convert to milliseconds
        });

        if (cachedClient) {
          this.hydrateEntity(cachedClient);
        }
        return cachedClient;
      } catch (error) {
        console.error(`Error fetching client ${id}:`, error);
        throw error;
      }
    }

    // Fallback to base implementation without caching
    return super.getById(id);
  }

  /**
   * Fetch all clients with optional filtering and caching
   *
   * If queryClient is configured, checks cache before making HTTP request.
   * Always hydrates the store with the results.
   *
   * Note: The API returns { clients: Client[], total: number } format,
   * so we need to extract the clients array from the response.
   *
   * @param filters - Optional filter criteria
   * @returns Promise resolving to array of clients
   */
  async getAll(filters?: Record<string, any>): Promise<Client[]> {
    // If queryClient is available, use it for caching
    if (this.queryClient) {
      try {
        const clients = await this.queryClient.fetchQuery({
          queryKey: ["clients", "all", filters],
          queryFn: async () => {
            const response = await this.adapter.get<
              Client[] | { clients: Client[]; total: number }
            >(this.getBasePath(), filters);
            // Handle both array and paginated response formats
            return Array.isArray(response) ? response : response.clients;
          },
          staleTime: this.cacheTTL * 1000 // Convert to milliseconds
        });

        this.hydrateEntities(clients);
        return clients;
      } catch (error) {
        console.error("Error fetching clients:", error);
        throw error;
      }
    }

    // Fallback without caching - handle paginated response format
    try {
      const response = await this.adapter.get<
        Client[] | { clients: Client[]; total: number }
      >(this.getBasePath(), filters);
      // Handle both array and paginated response formats
      const clients = Array.isArray(response) ? response : response.clients;
      this.hydrateEntities(clients);
      return clients;
    } catch (error) {
      console.error("Error fetching clients:", error);
      throw error;
    }
  }

  /**
   * Create a new client
   *
   * Creates the client on the backend, hydrates the store, and invalidates
   * the cache if queryClient is configured.
   *
   * @param data - Client data without ID
   * @returns Promise resolving to created client
   */
  async create(data: Omit<Client, "id">): Promise<Client> {
    try {
      const client = await this.adapter.post<Client>(this.getBasePath(), data);
      this.hydrateEntity(client);

      // Invalidate cache to ensure fresh data on next fetch
      if (this.queryClient) {
        await this.queryClient.invalidateQueries({
          queryKey: ["clients"]
        });
      }

      return client;
    } catch (error) {
      console.error("Error creating client:", error);
      throw error;
    }
  }

  /**
   * Update an existing client
   *
   * Updates the client on the backend, hydrates the store, and invalidates
   * the cache if queryClient is configured.
   *
   * @param id - Client identifier
   * @param data - Partial client data to update
   * @returns Promise resolving to updated client
   */
  async update(id: string, data: Partial<Client>): Promise<Client> {
    try {
      const client = await this.adapter.patch<Client>(
        `${this.getBasePath()}/${id}`,
        data
      );
      this.hydrateEntity(client);

      // Invalidate cache to ensure fresh data on next fetch
      if (this.queryClient) {
        await this.queryClient.invalidateQueries({
          queryKey: ["clients", id]
        });
        await this.queryClient.invalidateQueries({
          queryKey: ["clients", "all"]
        });
      }

      return client;
    } catch (error) {
      console.error(`Error updating client ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete a client
   *
   * Deletes the client on the backend, removes from store, and invalidates
   * the cache if queryClient is configured.
   *
   * @param id - Client identifier
   * @returns Promise resolving when deletion is complete
   */
  async delete(id: string): Promise<void> {
    try {
      await this.adapter.delete(`${this.getBasePath()}/${id}`);
      const entityType = this.getEntityType();
      this.dispatchRemoveEntity(entityType, id);

      // Invalidate cache to ensure fresh data on next fetch
      if (this.queryClient) {
        await this.queryClient.invalidateQueries({
          queryKey: ["clients", id]
        });
        await this.queryClient.invalidateQueries({
          queryKey: ["clients", "all"]
        });
      }
    } catch (error) {
      console.error(`Error deleting client ${id}:`, error);
      throw error;
    }
  }

  /**
   * Perform an optimistic update with automatic rollback on failure
   *
   * Immediately updates the store, then syncs with backend.
   * Rolls back to previous state if the backend request fails.
   * Invalidates cache on success.
   *
   * @param id - Client identifier
   * @param data - Partial client data to update
   * @returns Promise resolving to updated client
   */
  async updateOptimistic(id: string, data: Partial<Client>): Promise<Client> {
    // Use base implementation for optimistic update logic
    const client = await super.updateOptimistic(id, data);

    // Invalidate cache on success
    if (this.queryClient) {
      await this.queryClient.invalidateQueries({
        queryKey: ["clients", id]
      });
      await this.queryClient.invalidateQueries({
        queryKey: ["clients", "all"]
      });
    }

    return client;
  }

  // ============================================================================
  // IClientRepository Implementation - Domain-Specific Methods
  // ============================================================================

  /**
   * Get a client by ID (IClientRepository interface)
   *
   * @param clientId - Client identifier
   * @returns Promise resolving to client or null if not found
   */
  async getClientById(clientId: string): Promise<Client | null> {
    return this.getById(clientId);
  }

  /**
   * Get all clients for an organization
   *
   * @param organizationId - Organization identifier
   * @returns Promise resolving to array of clients
   */
  async getClientsByOrganization(organizationId: string): Promise<Client[]> {
    return this.getAll({ organizationId });
  }

  /**
   * Create a new client with DTO transformation
   *
   * @param data - Client creation data including organizationId
   * @returns Promise resolving to created client
   */
  async createClient(data: CreateClientData): Promise<Client> {
    // Transform DTO to entity format
    const clientData = {
      organizationId: data.organizationId,
      name: data.name,
      description: data.description ?? null,
      contactName: data.contactName ?? null,
      contactEmail: data.contactEmail ?? null,
      contactPhone: data.contactPhone ?? null,
      address: data.address ?? null,
      meta: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    return this.create(clientData);
  }

  /**
   * Update a client with DTO transformation
   *
   * @param clientId - Client identifier
   * @param data - Client update data
   * @returns Promise resolving to updated client
   */
  async updateClient(
    clientId: string,
    data: UpdateClientRequest
  ): Promise<Client> {
    // Transform DTO to entity format
    const updateData: Partial<Client> = {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.contactName !== undefined && { contactName: data.contactName }),
      ...(data.contactEmail !== undefined && {
        contactEmail: data.contactEmail
      }),
      ...(data.contactPhone !== undefined && {
        contactPhone: data.contactPhone
      }),
      ...(data.address !== undefined && { address: data.address }),
      updatedAt: new Date()
    };

    return this.update(clientId, updateData);
  }

  /**
   * Delete a client (IClientRepository interface)
   *
   * @param clientId - Client identifier
   * @returns Promise resolving when deletion is complete
   */
  async deleteClient(clientId: string): Promise<void> {
    return this.delete(clientId);
  }

  /**
   * Get clients for an organization with pagination
   *
   * @param organizationId - Organization identifier
   * @param page - Page number (1-indexed)
   * @param limit - Number of items per page
   * @returns Promise resolving to paginated clients and total count
   */
  async getClientsByOrganizationWithPagination(
    organizationId: string,
    page: number,
    limit: number
  ): Promise<{ clients: Client[]; total: number }> {
    // If queryClient is available, use it for caching
    if (this.queryClient) {
      try {
        const result = await this.queryClient.fetchQuery({
          queryKey: ["clients", "paginated", organizationId, page, limit],
          queryFn: async () => {
            const response = await this.adapter.get<{
              clients: Client[];
              total: number;
            }>(`${this.getBasePath()}/paginated`, {
              organizationId,
              page,
              limit
            });
            return response;
          },
          staleTime: this.cacheTTL * 1000
        });

        // Hydrate store with fetched clients
        this.hydrateEntities(result.clients);
        return result;
      } catch (error) {
        console.error("Error fetching paginated clients:", error);
        throw error;
      }
    }

    // Fallback without caching
    try {
      const response = await this.adapter.get<{
        clients: Client[];
        total: number;
      }>(`${this.getBasePath()}/paginated`, {
        organizationId,
        page,
        limit
      });

      this.hydrateEntities(response.clients);
      return response;
    } catch (error) {
      console.error("Error fetching paginated clients:", error);
      throw error;
    }
  }
}
