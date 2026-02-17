/**
 * Supplier Repository (Cold Data)
 *
 * Manages supplier data fetching, caching, and store hydration.
 * Suppliers are cold data - they change infrequently and use longer cache TTLs.
 */

import type {
  CreateSupplierRequest,
  Supplier,
  SupplierListResponse,
  SupplierMatch,
  UpdateSupplierRequest,
  WebSocketPayload
} from "@packages/types";
import { TABLE_NAMES } from "@packages/types";
import {
  removeSupplier,
  removeSupplierMatch,
  setSupplier,
  setSupplierMatch,
  setSupplierMatches,
  setSuppliers
} from "../store/slices/entities-slice";
import {
  setSupplierMatchesError,
  setSuppliersError
} from "../store/slices/ui-slice";
import type { RootState } from "../store/store";
import {
  BaseRepository,
  IColdRepository,
  type HotRepositoryDependencies,
  type RepositoryDependencies
} from "./base-repository";

/**
 * Response type for supplier matches endpoint
 * Backend returns matches with supplier relation included
 */
interface GetJobSupplierMatchesResponse {
  extractionResults: Array<{
    id: string;
    data: Record<string, unknown>;
    status?: string;
    matches: Array<SupplierMatch & { supplier?: Supplier }>;
  }>;
}

/**
 * Repository for managing Supplier entities and matches
 *
 * Implements the store-first pattern for:
 * - Fetching suppliers
 * - Creating, updating, and deleting suppliers
 * - Fetching supplier matches for extraction jobs
 * - Selecting suppliers for extraction results
 * - WebSocket subscription for realtime supplier match updates
 */
export class SupplierRepository
  extends BaseRepository<Supplier>
  implements IColdRepository<Supplier>
{
  /**
   * Cache TTL for cold data: 300 seconds (5 minutes)
   */
  readonly cacheTTL = 300;

  private readonly wsService?: any; // IWebSocketService - optional for cold repository
  private subscribed = false;
  private readonly channelName = TABLE_NAMES.SUPPLIER_MATCHES;
  private currentJobId: string | null = null;

  constructor(
    dependencies: RepositoryDependencies | HotRepositoryDependencies
  ) {
    super(dependencies);
    // WebSocket service is optional - only available if HotRepositoryDependencies provided
    this.wsService = (dependencies as HotRepositoryDependencies).wsService;
  }

  /**
   * Get the base API path for supplier endpoints
   */
  protected getBasePath(): string {
    return "/suppliers";
  }

  /**
   * Get the entity type name for store operations
   */
  protected getEntityType(): keyof RootState["entities"] {
    return "suppliers";
  }

  /**
   * Dispatch action to set a single supplier in the store
   */
  protected dispatchSetEntity(
    _entityType: keyof RootState["entities"],
    entity: Supplier
  ): void {
    this.store.dispatch(setSupplier(entity));
  }

  /**
   * Dispatch action to set multiple suppliers in the store
   */
  protected dispatchSetEntities(
    _entityType: keyof RootState["entities"],
    entities: Supplier[]
  ): void {
    this.store.dispatch(setSuppliers(entities));
  }

  /**
   * Dispatch action to remove a supplier from the store
   */
  protected dispatchRemoveEntity(
    _entityType: keyof RootState["entities"],
    id: string
  ): void {
    this.store.dispatch(removeSupplier(id));
  }

  /**
   * Dispatch action to set error state in the UI slice
   */
  protected dispatchError(
    _entityType: keyof RootState["entities"],
    errorMessage: string
  ): void {
    this.store.dispatch(setSuppliersError(errorMessage));
  }

  /**
   * Fetch all suppliers
   */
  async getAllSuppliers(): Promise<Supplier[]> {
    try {
      const response = await this.adapter.get<SupplierListResponse>(
        this.getBasePath()
      );
      // Extract suppliers array from paginated response
      const suppliers = response.suppliers || [];
      this.store.dispatch(setSuppliers(suppliers));
      return suppliers;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to fetch suppliers";
      this.store.dispatch(setSuppliersError(errorMessage));
      throw error;
    }
  }

  /**
   * Fetch a single supplier by ID
   */
  async getSupplierById(supplierId: string): Promise<Supplier | null> {
    try {
      const response = await this.adapter.get<Supplier>(
        `${this.getBasePath()}/${supplierId}`
      );
      this.store.dispatch(setSupplier(response));
      return response;
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "getSupplierById",
          supplierId,
          error: error instanceof Error ? error.message : "Unknown error"
        })
      );
      throw error;
    }
  }

  /**
   * Fetch suppliers with pagination
   */
  async getSuppliers(
    page: number = 1,
    limit: number = 50
  ): Promise<{ suppliers: Supplier[]; total: number }> {
    try {
      const response = await this.adapter.get<{
        suppliers: Supplier[];
        total: number;
      }>(`${this.getBasePath()}?page=${page}&limit=${limit}`);

      this.store.dispatch(setSuppliers(response.suppliers));
      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to fetch suppliers";
      this.store.dispatch(setSuppliersError(errorMessage));
      throw error;
    }
  }

  /**
   * Create a new supplier
   */
  async createSupplier(data: CreateSupplierRequest): Promise<Supplier> {
    try {
      const response = await this.adapter.post<Supplier>(
        this.getBasePath(),
        data
      );
      this.store.dispatch(setSupplier(response));
      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to create supplier";
      this.store.dispatch(setSuppliersError(errorMessage));
      throw error;
    }
  }

  /**
   * Update an existing supplier
   */
  async updateSupplier(
    supplierId: string,
    data: UpdateSupplierRequest
  ): Promise<Supplier> {
    try {
      const response = await this.adapter.put<Supplier>(
        `${this.getBasePath()}/${supplierId}`,
        data
      );
      this.store.dispatch(setSupplier(response));
      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to update supplier";
      this.store.dispatch(setSuppliersError(errorMessage));
      throw error;
    }
  }

  /**
   * Delete a supplier
   */
  async deleteSupplier(supplierId: string): Promise<void> {
    try {
      await this.adapter.delete(`${this.getBasePath()}/${supplierId}`);
      this.store.dispatch(removeSupplier(supplierId));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to delete supplier";
      this.store.dispatch(setSuppliersError(errorMessage));
      throw error;
    }
  }

  /**
   * Fetch supplier matches for an extraction job
   */
  async getJobSupplierMatches(jobId: string): Promise<SupplierMatch[]> {
    try {
      // Track current jobId for WebSocket refetch
      this.currentJobId = jobId;

      const response = await this.adapter.get<GetJobSupplierMatchesResponse>(
        `/extraction/job/${jobId}/supplier-matches`
      );

      // Extract and flatten all matches from results
      // Also extract and store suppliers separately (normalize relations)
      const allMatches: SupplierMatch[] = [];
      const suppliersToStore: Supplier[] = [];

      response.extractionResults.forEach((result) => {
        (result.matches || []).forEach((match: any) => {
          // Convert dates to ISO strings for Redux serialization
          // Redux state must be serializable - Date objects are not
          const toISOString = (date: unknown): string => {
            if (!date) return new Date().toISOString();
            if (date instanceof Date) return date.toISOString();
            if (typeof date === "string") return date;
            return new Date().toISOString();
          };

          // Store the match (without supplier relation for Redux)
          allMatches.push({
            id: match.id,
            extractionResultId: match.extractionResultId,
            supplierId: match.supplierId,
            confidenceScore: match.confidenceScore,
            matchReason: match.matchReason,
            matchMetadata: match.matchMetadata,
            isSelected: match.isSelected,
            selectedBy: match.selectedBy,
            selectedAt: match.selectedAt ? toISOString(match.selectedAt) : null,
            emailSent: match.emailSent,
            emailSentAt: match.emailSentAt
              ? toISOString(match.emailSentAt)
              : null,
            meta: match.meta,
            createdAt: toISOString(match.createdAt),
            updatedAt: toISOString(match.updatedAt)
          } as any); // Type assertion needed because Zod expects Date but Redux needs strings

          // Store supplier separately if it exists
          if (match.supplier) {
            suppliersToStore.push(match.supplier as Supplier);
          }
        });
      });

      // Hydrate store with supplier matches and suppliers
      console.log(
        JSON.stringify({
          level: "info",
          action: "getJobSupplierMatches",
          jobId,
          matchesCount: allMatches.length,
          suppliersCount: suppliersToStore.length,
          message: "Storing matches and suppliers in Redux"
        })
      );

      this.store.dispatch(setSupplierMatches(allMatches));
      if (suppliersToStore.length > 0) {
        this.store.dispatch(setSuppliers(suppliersToStore));
      }

      return allMatches;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to fetch supplier matches";
      this.store.dispatch(setSupplierMatchesError(errorMessage));
      throw error;
    }
  }

  /**
   * Subscribe to WebSocket channel for realtime supplier match updates
   * Only works if wsService is available (HotRepositoryDependencies)
   */
  subscribeSupplierMatches(): void {
    if (!this.wsService) {
      console.warn(
        JSON.stringify({
          level: "warn",
          action: "subscribeSupplierMatches",
          message: "WebSocket service not available"
        })
      );
      return;
    }

    if (this.subscribed) {
      return;
    }

    this.wsService.subscribe(this.channelName, this.handleWebSocketMessage);
    this.subscribed = true;

    console.log(
      JSON.stringify({
        level: "info",
        action: "subscribeSupplierMatches",
        channel: this.channelName
      })
    );
  }

  /**
   * Unsubscribe from WebSocket channel
   */
  unsubscribeSupplierMatches(): void {
    if (!this.wsService || !this.subscribed) {
      return;
    }

    this.wsService.unsubscribe(this.channelName, this.handleWebSocketMessage);
    this.subscribed = false;

    console.log(
      JSON.stringify({
        level: "info",
        action: "unsubscribeSupplierMatches",
        channel: this.channelName
      })
    );
  }

  /**
   * Handle incoming WebSocket messages for supplier match updates
   * Refetches supplier matches for the current job when matches are created/updated/deleted
   */
  private handleWebSocketMessage = (payload: WebSocketPayload): void => {
    try {
      const { op } = payload;
      const data = payload.new || payload.old;

      if (!data || typeof data !== "object") {
        console.warn(
          JSON.stringify({
            level: "warn",
            action: "handleSupplierMatchWebSocket",
            message: "WebSocket payload missing valid data",
            payload
          })
        );
        return;
      }

      // Check for extraction_result_id (snake_case from database) or extractionResultId (camelCase)
      const extractionResultId =
        (data as any).extraction_result_id || (data as any).extractionResultId;

      if (!extractionResultId) {
        console.warn(
          JSON.stringify({
            level: "warn",
            action: "handleSupplierMatchWebSocket",
            message: "WebSocket payload missing extraction_result_id",
            payload
          })
        );
        return;
      }

      // When supplier matches are created/updated/deleted, refetch matches for the current job
      // This ensures the UI stays in sync with the database
      if (
        this.currentJobId &&
        (op === "INSERT" || op === "UPDATE" || op === "DELETE")
      ) {
        console.log(
          JSON.stringify({
            level: "info",
            action: "handleSupplierMatchWebSocket",
            operation: op,
            extractionResultId,
            message: "Refetching supplier matches for job"
          })
        );

        // Refetch matches for the current job
        void this.getJobSupplierMatches(this.currentJobId).catch((error) => {
          console.error(
            JSON.stringify({
              level: "error",
              action: "handleSupplierMatchWebSocket",
              error: error instanceof Error ? error.message : "Unknown error"
            })
          );
        });
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "handleSupplierMatchWebSocket",
          error: error instanceof Error ? error.message : "Unknown error"
        })
      );
    }
  };

  /**
   * Start supplier matching for an extraction job
   */
  async matchSuppliers(
    jobId: string
  ): Promise<{ jobId: string; status: string }> {
    try {
      const response = await this.adapter.post<{
        jobId: string;
        status: string;
      }>(`/extraction/job/${jobId}/match-suppliers`, {});
      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to start supplier matching";
      this.store.dispatch(setSupplierMatchesError(errorMessage));
      throw error;
    }
  }

  /**
   * Select a supplier for an extraction result
   */
  async selectSupplier(
    resultId: string,
    supplierId: string
  ): Promise<SupplierMatch> {
    try {
      const response = await this.adapter.put<SupplierMatch>(
        `/extraction/result/${resultId}/select-supplier`,
        { supplierId }
      );

      // Get all matches for this extraction result and update them
      const state = this.store.getState();
      const allMatches = Object.values(state.entities.supplierMatches).filter(
        (m) => m.extractionResultId === resultId
      );

      // Create updated matches array
      const updatedMatches = allMatches.map((match) => ({
        ...match,
        isSelected: match.supplierId === supplierId
      }));

      // Dispatch all updates
      this.store.dispatch(setSupplierMatches(updatedMatches));

      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to select supplier";
      this.store.dispatch(setSupplierMatchesError(errorMessage));
      throw error;
    }
  }

  /**
   * Unselect a supplier for an extraction result
   */
  async unselectSupplier(resultId: string): Promise<void> {
    try {
      await this.adapter.put(
        `/extraction/result/${resultId}/unselect-supplier`,
        {}
      );

      // Find and remove the match from store
      const state = this.store.getState();
      const matchToRemove = Object.values(state.entities.supplierMatches).find(
        (m) => m.extractionResultId === resultId
      );

      if (matchToRemove) {
        this.store.dispatch(removeSupplierMatch(matchToRemove.id));
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to unselect supplier";
      this.store.dispatch(setSupplierMatchesError(errorMessage));
      throw error;
    }
  }
}
