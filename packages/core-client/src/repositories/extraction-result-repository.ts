import type {
  CreateManualResultRequest,
  ExtractionResult,
  ExtractionResultStatus,
  ExtractionResultWithEvidence,
  IExtractionResultRepository,
  IWebSocketService,
  ResultsStatsResponse,
  UpdateExtractionResultRequest,
  VerificationStatsResponse,
  VerifyExtractionResultRequest,
  WebSocketPayload
} from "@packages/types";
import { TABLE_NAMES } from "@packages/types";
import {
  removeExtractionResult,
  setExtractionResult,
  setExtractionResults
} from "../store/slices/entities-slice";
import { setResultsError } from "../store/slices/ui-slice";
import type { RootState } from "../store/store";
import {
  BaseRepository,
  HotRepositoryDependencies,
  IHotRepository
} from "./base-repository";

/**
 * Repository for managing ExtractionResult entities with realtime updates
 *
 * Implements both the store-first pattern (IHotRepository) and
 * the domain-specific interface (IExtractionResultRepository) for:
 * - Optional TanStack Query caching with 30s TTL (short for hot data)
 * - Store hydration after all fetch operations
 * - WebSocket subscription for realtime result updates
 * - Cache invalidation on mutations
 * - Optimistic updates with rollback
 * - Business-specific operations (verification, statistics, filtering)
 */
export class ExtractionResultRepository
  extends BaseRepository<ExtractionResult>
  implements IHotRepository<ExtractionResult>, IExtractionResultRepository
{
  /**
   * Cache TTL for hot data: 30 seconds
   */
  readonly cacheTTL = 30;

  private readonly wsService: IWebSocketService;
  private subscribed = false;
  private readonly channelName = TABLE_NAMES.EXTRACTION_RESULTS;

  constructor(dependencies: HotRepositoryDependencies) {
    super(dependencies);
    this.wsService = dependencies.wsService;

    // Subscribe to WebSocket channel for realtime updates
    this.subscribe();
  }

  /**
   * Get the base API path for extraction result endpoints
   */
  protected getBasePath(): string {
    return "/extraction-results";
  }

  /**
   * Get the entity type name for store operations
   */
  protected getEntityType(): keyof RootState["entities"] {
    return "extractionResults";
  }

  /**
   * Dispatch action to set a single extraction result in the store
   */
  protected dispatchSetEntity(
    _entityType: keyof RootState["entities"],
    entity: ExtractionResult
  ): void {
    this.store.dispatch(setExtractionResult(entity));
  }

  /**
   * Dispatch action to set multiple extraction results in the store
   */
  protected dispatchSetEntities(
    _entityType: keyof RootState["entities"],
    entities: ExtractionResult[]
  ): void {
    this.store.dispatch(setExtractionResults(entities));
  }

  /**
   * Dispatch action to remove an extraction result from the store
   */
  protected dispatchRemoveEntity(
    _entityType: keyof RootState["entities"],
    id: string
  ): void {
    this.store.dispatch(removeExtractionResult(id));
  }

  /**
   * Dispatch action to set error state in the UI slice for extraction results
   * Called by optimistic update on failure (Requirement 7.5, 20.5)
   */
  protected dispatchSetError(error: string | null): void {
    this.store.dispatch(setResultsError(error));
  }

  // ============================================================================
  // IHotRepository Implementation - WebSocket Subscription
  // ============================================================================

  /**
   * Subscribe to WebSocket channel for realtime extraction result updates
   *
   * Handles incoming messages and updates the store directly when results are created or updated.
   */
  subscribe(): void {
    if (this.subscribed) {
      return;
    }

    this.wsService.subscribe(this.channelName, this.handleWebSocketMessage);
    this.subscribed = true;
  }

  /**
   * Unsubscribe from WebSocket channel
   *
   * Should be called when the repository is no longer needed (e.g., component unmount)
   */
  unsubscribe(): void {
    if (!this.subscribed) {
      return;
    }

    this.wsService.unsubscribe(this.channelName, this.handleWebSocketMessage);
    this.subscribed = false;
  }

  /**
   * Check if repository is currently subscribed to WebSocket updates
   */
  isSubscribed(): boolean {
    return this.subscribed;
  }

  /**
   * Handle incoming WebSocket messages for extraction result updates
   *
   * Updates the store directly when results change, triggering component re-renders.
   * Also invalidates TanStack Query cache to keep it in sync with the store.
   *
   * Payload format from PostgreSQL triggers:
   * - INSERT/UPDATE: { op, table, new: {...} }
   * - DELETE: { op, table, old: {...} }
   */
  private handleWebSocketMessage = (payload: WebSocketPayload): void => {
    try {
      const { op } = payload;
      // Backend sends 'new' for INSERT/UPDATE and 'old' for DELETE
      const data = payload.new || payload.old;

      if (!data || typeof data !== "object" || !("id" in data)) {
        console.warn("WebSocket payload missing valid data:", payload);
        return;
      }

      switch (op) {
        case "INSERT":
          // New result created - hydrate store with new result
          this.hydrateEntity(data as ExtractionResult);
          this.invalidateCacheForResult(data.id as string);
          break;

        case "UPDATE":
          // Result updated - hydrate store with updated result
          this.hydrateEntity(data as ExtractionResult);
          this.invalidateCacheForResult(data.id as string);
          break;

        case "DELETE":
          // Result deleted - remove from store
          this.dispatchRemoveEntity(this.getEntityType(), data.id as string);
          this.invalidateCacheForResult(data.id as string);
          break;

        default:
          console.warn(`Unknown WebSocket operation: ${op}`);
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
    }
  };

  /**
   * Invalidate TanStack Query cache for a specific result
   * Called after WebSocket updates to keep cache in sync with store
   */
  private invalidateCacheForResult(resultId: string): void {
    if (this.queryClient) {
      void this.queryClient.invalidateQueries({
        queryKey: ["extraction-results", resultId]
      });
      void this.queryClient.invalidateQueries({
        queryKey: ["extraction-results", "all"]
      });
    }
  }

  /**
   * Cleanup method for proper lifecycle management
   * Should be called when the repository instance is no longer needed
   */
  destroy(): void {
    this.unsubscribe();
  }

  // ============================================================================
  // Base Repository Overrides with Short-TTL Caching
  // ============================================================================

  /**
   * Fetch a single extraction result by ID
   * Hot data should not use cache - always fetch fresh
   * WebSocket subscriptions and Redux store are the source of truth
   */
  async getById(id: string): Promise<ExtractionResult | null> {
    return super.getById(id);
  }

  /**
   * Fetch all extraction results with optional filtering
   * Hot data should not use cache - always fetch fresh
   * WebSocket subscriptions and Redux store are the source of truth
   */
  async getAll(filters?: Record<string, any>): Promise<ExtractionResult[]> {
    return super.getAll(filters);
  }

  /**
   * Create a new extraction result
   */
  async create(data: Omit<ExtractionResult, "id">): Promise<ExtractionResult> {
    try {
      const result = await this.adapter.post<ExtractionResult>(
        this.getBasePath(),
        data
      );
      this.hydrateEntity(result);

      if (this.queryClient) {
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-results"]
        });
      }

      return result;
    } catch (error) {
      console.error("Error creating extraction result:", error);
      throw error;
    }
  }

  /**
   * Update an existing extraction result
   * Uses the /extraction/result/:id endpoint for status and data updates
   */
  async update(
    id: string,
    data: Partial<ExtractionResult>
  ): Promise<ExtractionResult> {
    try {
      // Determine which endpoint to use based on what's being updated
      const { status, ...otherData } = data as any;

      // If only status is being updated, use the dedicated status endpoint
      if (status && Object.keys(otherData).length === 0) {
        const result = await this.adapter.put<ExtractionResult>(
          `/extraction/result/${id}/status`, // Use the /status endpoint
          { status } // Only pass status field
        );
        this.hydrateEntity(result);

        if (this.queryClient) {
          await this.queryClient.invalidateQueries({
            queryKey: ["extraction-results", id]
          });
          await this.queryClient.invalidateQueries({
            queryKey: ["extraction-results", "all"]
          });
        }

        return result;
      }

      const payload: any = {};
      const metadataFields = new Set([
        "status",
        "verifiedBy",
        "verifiedAt",
        "editedBy",
        "editedAt",
        "verificationNotes",
        "id",
        "extractionJobId",
        "createdAt",
        "updatedAt",
        "rawExtraction",
        "evidence",
        "agentExecutionMetadata",
        "confidenceScore",
        "pageNumber",
        "validationErrors",
        "originalSnippet",
        "initialResults",
        "supplierMatches"
      ]);

      const dataToSend: Record<string, any> = {};
      for (const [key, value] of Object.entries(data)) {
        if (!metadataFields.has(key)) {
          dataToSend[key] = value;
        }
      }

      if (Object.keys(dataToSend).length > 0) {
        payload.data = dataToSend;
      }

      if (status) {
        payload.status = status;
      }

      const result = await this.adapter.put<ExtractionResult>(
        `/extraction/result/${id}`,
        payload
      );
      this.hydrateEntity(result);

      if (this.queryClient) {
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-results", id]
        });
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-results", "all"]
        });
      }

      return result;
    } catch (error) {
      console.error(`Error updating extraction result ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete an extraction result
   * Uses the /extraction/result/delete endpoint
   */
  async delete(id: string): Promise<void> {
    try {
      await this.adapter.post(`/extraction/result/delete`, { resultIds: [id] });
      const entityType = this.getEntityType();
      this.dispatchRemoveEntity(entityType, id);

      if (this.queryClient) {
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-results", id]
        });
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-results", "all"]
        });
      }
    } catch (error) {
      console.error(`Error deleting extraction result ${id}:`, error);
      throw error;
    }
  }

  /**
   * Perform an optimistic update with automatic rollback on failure
   */
  async updateOptimistic(
    id: string,
    data: Partial<ExtractionResult>
  ): Promise<ExtractionResult> {
    const result = await super.updateOptimistic(id, data);

    if (this.queryClient) {
      await this.queryClient.invalidateQueries({
        queryKey: ["extraction-results", id]
      });
      await this.queryClient.invalidateQueries({
        queryKey: ["extraction-results", "all"]
      });
    }

    return result;
  }

  // ============================================================================
  // IExtractionResultRepository Implementation - Domain-Specific Methods
  // ============================================================================

  /**
   * Get an extraction result by ID (IExtractionResultRepository interface)
   */
  async getExtractionResultById(
    resultId: string
  ): Promise<ExtractionResult | null> {
    return this.getById(resultId);
  }

  /**
   * Get all extraction results for a job
   */
  async getExtractionResultsByJob(jobId: string): Promise<ExtractionResult[]> {
    return this.getAll({ extractionJobId: jobId });
  }

  /**
   * Get extraction results for a job with pagination
   */
  async getExtractionResultsByJobWithPagination(
    jobId: string,
    page: number,
    limit: number
  ): Promise<{ results: ExtractionResult[]; total: number; schema?: any }> {
    try {
      // Use the correct backend endpoint: GET /extraction/job/:jobId/results
      const response = await this.adapter.get<{
        results: ExtractionResult[];
        schema?: any;
      }>(`/extraction/job/${jobId}/results`, {
        page,
        limit
      });

      this.hydrateEntities(response.results);
      return {
        results: response.results,
        total: response.results.length,
        schema: response.schema
      };
    } catch (error) {
      console.error(
        `Error fetching paginated extraction results for job ${jobId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Create a manual extraction result (user-created)
   * Uses the /extraction/result/manual endpoint
   */
  async createManualExtractionResult(
    data: CreateManualResultRequest
  ): Promise<ExtractionResult> {
    try {
      const result = await this.adapter.post<ExtractionResult>(
        `/extraction/result/manual`,
        data
      );
      this.hydrateEntity(result);

      if (this.queryClient) {
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-results"]
        });
      }

      return result;
    } catch (error) {
      console.error("Error creating manual extraction result:", error);
      throw error;
    }
  }

  /**
   * Update an extraction result
   */
  async updateExtractionResult(
    resultId: string,
    data: UpdateExtractionResultRequest
  ): Promise<ExtractionResult> {
    return this.update(resultId, data as Partial<ExtractionResult>);
  }

  /**
   * Update extraction result status
   */
  async updateExtractionResultStatus(
    resultId: string,
    status: ExtractionResultStatus,
    notes?: string
  ): Promise<ExtractionResult> {
    const updateData: Partial<ExtractionResult> = {
      status,
      updatedAt: new Date()
    };

    if (notes) {
      updateData.verificationNotes = notes;
    }

    return this.update(resultId, updateData);
  }

  /**
   * Verify an extraction result with human-verified data
   */
  async verifyExtractionResult(
    resultId: string,
    data: VerifyExtractionResultRequest,
    verifiedBy: string
  ): Promise<ExtractionResult> {
    try {
      const result = await this.adapter.post<ExtractionResult>(
        `${this.getBasePath()}/${resultId}/verify`,
        {
          ...data,
          verifiedBy
        }
      );
      this.hydrateEntity(result);

      if (this.queryClient) {
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-results", resultId]
        });
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-results", "all"]
        });
      }

      return result;
    } catch (error) {
      console.error(`Error verifying extraction result ${resultId}:`, error);
      throw error;
    }
  }

  /**
   * Delete an extraction result
   */
  async deleteExtractionResult(resultId: string): Promise<void> {
    return this.delete(resultId);
  }

  /**
   * Delete multiple extraction results
   */
  async deleteExtractionResults(resultIds: string[]): Promise<void> {
    try {
      await this.adapter.post(`${this.getBasePath()}/bulk-delete`, {
        resultIds
      });

      // Remove all results from store
      const entityType = this.getEntityType();
      resultIds.forEach((id) => {
        this.dispatchRemoveEntity(entityType, id);
      });

      if (this.queryClient) {
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-results"]
        });
      }
    } catch (error) {
      console.error("Error deleting extraction results:", error);
      throw error;
    }
  }

  /**
   * Get extraction results filtered by status
   */
  async getExtractionResultsByStatus(
    jobId: string,
    status: ExtractionResultStatus
  ): Promise<ExtractionResult[]> {
    return this.getAll({ extractionJobId: jobId, status });
  }

  /**
   * Get extraction results filtered by confidence score
   */
  async getExtractionResultsByConfidenceScore(
    jobId: string,
    minScore: number
  ): Promise<ExtractionResult[]> {
    try {
      const results = await this.adapter.get<ExtractionResult[]>(
        `${this.getBasePath()}/job/${jobId}/by-confidence`,
        { minScore }
      );
      this.hydrateEntities(results);
      return results;
    } catch (error) {
      console.error(
        `Error fetching extraction results by confidence score for job ${jobId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get extraction results with evidence (enhanced view)
   */
  async getExtractionResultsWithEvidence(
    jobId: string
  ): Promise<ExtractionResultWithEvidence[]> {
    try {
      const results = await this.adapter.get<ExtractionResultWithEvidence[]>(
        `${this.getBasePath()}/job/${jobId}/with-evidence`
      );
      return results;
    } catch (error) {
      console.error(
        `Error fetching extraction results with evidence for job ${jobId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get statistics for extraction results in a job
   */
  async getResultsStats(jobId: string): Promise<ResultsStatsResponse> {
    try {
      const stats = await this.adapter.get<ResultsStatsResponse>(
        `${this.getBasePath()}/job/${jobId}/stats`
      );
      return stats;
    } catch (error) {
      console.error(`Error fetching results stats for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get verification statistics for a job
   */
  async getVerificationStats(
    jobId: string
  ): Promise<VerificationStatsResponse> {
    try {
      const stats = await this.adapter.get<VerificationStatsResponse>(
        `${this.getBasePath()}/job/${jobId}/verification-stats`
      );
      return stats;
    } catch (error) {
      console.error(
        `Error fetching verification stats for job ${jobId}:`,
        error
      );
      throw error;
    }
  }
}
