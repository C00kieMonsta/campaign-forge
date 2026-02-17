import type {
  CreateExtractionJobData,
  ExtractionJob,
  IExtractionJobRepository,
  IWebSocketService,
  WebSocketPayload
} from "@packages/types";
import { TABLE_NAMES } from "@packages/types";
import {
  removeExtractionJob,
  setExtractionJob,
  setExtractionJobs
} from "../store/slices/entities-slice";
import { setJobsError } from "../store/slices/ui-slice";
import type { RootState } from "../store/store";
import {
  BaseRepository,
  HotRepositoryDependencies,
  IHotRepository
} from "./base-repository";

/**
 * Repository for managing ExtractionJob entities with realtime updates
 */
export class ExtractionJobRepository
  extends BaseRepository<ExtractionJob>
  implements IHotRepository<ExtractionJob>, IExtractionJobRepository
{
  /**
   * Cache TTL for hot data: 30 seconds
   */
  readonly cacheTTL = 30;

  private readonly wsService: IWebSocketService;
  private subscribed = false;
  private readonly channelName = TABLE_NAMES.EXTRACTION_JOBS;

  constructor(dependencies: HotRepositoryDependencies) {
    super(dependencies);
    this.wsService = dependencies.wsService;

    // Subscribe to WebSocket channel for realtime updates
    this.subscribe();
  }

  /**
   * Get the base API path for extraction job endpoints
   */
  protected getBasePath(): string {
    return "/extraction-jobs";
  }

  /**
   * Get the entity type name for store operations
   */
  protected getEntityType(): keyof RootState["entities"] {
    return "extractionJobs";
  }

  /**
   * Dispatch action to set a single extraction job in the store
   */
  protected dispatchSetEntity(
    _entityType: keyof RootState["entities"],
    entity: ExtractionJob
  ): void {
    this.store.dispatch(setExtractionJob(entity));
  }

  /**
   * Dispatch action to set multiple extraction jobs in the store
   */
  protected dispatchSetEntities(
    _entityType: keyof RootState["entities"],
    entities: ExtractionJob[]
  ): void {
    console.log(
      `[ExtractionJobRepository] dispatchSetEntities called with ${entities.length} entities`
    );
    this.store.dispatch(setExtractionJobs(entities));
    console.log(
      `[ExtractionJobRepository] Action dispatched. Store state:`,
      this.store.getState().entities.extractionJobs
    );
  }

  /**
   * Dispatch action to remove an extraction job from the store
   */
  protected dispatchRemoveEntity(
    _entityType: keyof RootState["entities"],
    id: string
  ): void {
    this.store.dispatch(removeExtractionJob(id));
  }

  /**
   * Dispatch action to set error state in the UI slice for extraction jobs
   * Called by optimistic update on failure (Requirement 7.5, 20.5)
   */
  protected dispatchSetError(error: string | null): void {
    this.store.dispatch(setJobsError(error));
  }

  // ============================================================================
  // IHotRepository Implementation - WebSocket Subscription
  // ============================================================================

  /**
   * Subscribe to WebSocket channel for realtime extraction job updates
   *
   * Handles incoming messages and updates the store directly when job status changes.
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
   * Handle incoming WebSocket messages for extraction job updates
   *
   * Updates the store directly when job status changes, triggering component re-renders.
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
          // New job created - hydrate store with new job
          this.hydrateEntity(data as ExtractionJob);
          this.invalidateCacheForJob(data.id as string);
          break;

        case "UPDATE":
          // Job updated - hydrate store with updated job
          this.hydrateEntity(data as ExtractionJob);
          this.invalidateCacheForJob(data.id as string);
          break;

        case "DELETE":
          // Job deleted - remove from store
          this.dispatchRemoveEntity(this.getEntityType(), data.id as string);
          this.invalidateCacheForJob(data.id as string);
          break;

        default:
          console.warn(`Unknown WebSocket operation: ${op}`);
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
    }
  };

  /**
   * Invalidate TanStack Query cache for a specific job
   * Called after WebSocket updates to keep cache in sync with store
   */
  private invalidateCacheForJob(jobId: string): void {
    if (this.queryClient) {
      // Use void to explicitly ignore the promise
      void this.queryClient.invalidateQueries({
        queryKey: ["extraction-jobs", jobId]
      });
      void this.queryClient.invalidateQueries({
        queryKey: ["extraction-jobs", "all"]
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
   * Fetch a single extraction job by ID
   * Hot data should not use cache - always fetch fresh
   * WebSocket subscriptions and Redux store are the source of truth
   *
   * @param id - ExtractionJob identifier
   * @returns Promise resolving to extraction job or null if not found
   */
  async getById(id: string): Promise<ExtractionJob | null> {
    // Hot data should not use TanStack Query cache to avoid stale data
    // Rely on WebSocket subscriptions for real-time updates
    return super.getById(id);
  }

  /**
   * Fetch all extraction jobs with optional filtering
   * Hot data should not use cache - always fetch fresh
   * WebSocket subscriptions and Redux store are the source of truth
   *
   * @param filters - Optional filter criteria
   * @returns Promise resolving to array of extraction jobs
   */
  async getAll(filters?: Record<string, any>): Promise<ExtractionJob[]> {
    // Hot data should not use TanStack Query cache to avoid stale data
    // Rely on WebSocket subscriptions for real-time updates
    return super.getAll(filters);
  }

  /**
   * Create a new extraction job
   *
   * Creates the job on the backend, hydrates the store, and invalidates
   * the cache if queryClient is configured.
   *
   * @param data - ExtractionJob data without ID
   * @returns Promise resolving to created extraction job
   */
  async create(data: Omit<ExtractionJob, "id">): Promise<ExtractionJob> {
    try {
      const job = await this.adapter.post<ExtractionJob>(
        this.getBasePath(),
        data
      );
      this.hydrateEntity(job);

      // Invalidate cache to ensure fresh data on next fetch
      if (this.queryClient) {
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-jobs"]
        });
      }

      return job;
    } catch (error) {
      console.error("Error creating extraction job:", error);
      throw error;
    }
  }

  /**
   * Update an existing extraction job
   *
   * Updates the job on the backend, hydrates the store, and invalidates
   * the cache if queryClient is configured.
   *
   * @param id - ExtractionJob identifier
   * @param data - Partial extraction job data to update
   * @returns Promise resolving to updated extraction job
   */
  async update(
    id: string,
    data: Partial<ExtractionJob>
  ): Promise<ExtractionJob> {
    try {
      const job = await this.adapter.patch<ExtractionJob>(
        `${this.getBasePath()}/${id}`,
        data
      );
      this.hydrateEntity(job);

      // Invalidate cache to ensure fresh data on next fetch
      if (this.queryClient) {
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-jobs", id]
        });
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-jobs", "all"]
        });
      }

      return job;
    } catch (error) {
      console.error(`Error updating extraction job ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete an extraction job
   *
   * Deletes the job on the backend, removes from store, and invalidates
   * the cache if queryClient is configured.
   *
   * @param id - ExtractionJob identifier
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
          queryKey: ["extraction-jobs", id]
        });
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-jobs", "all"]
        });
      }
    } catch (error) {
      console.error(`Error deleting extraction job ${id}:`, error);
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
   * @param id - ExtractionJob identifier
   * @param data - Partial extraction job data to update
   * @returns Promise resolving to updated extraction job
   */
  async updateOptimistic(
    id: string,
    data: Partial<ExtractionJob>
  ): Promise<ExtractionJob> {
    // Use base implementation for optimistic update logic
    const job = await super.updateOptimistic(id, data);

    // Invalidate cache on success
    if (this.queryClient) {
      await this.queryClient.invalidateQueries({
        queryKey: ["extraction-jobs", id]
      });
      await this.queryClient.invalidateQueries({
        queryKey: ["extraction-jobs", "all"]
      });
    }

    return job;
  }

  // ============================================================================
  // IExtractionJobRepository Implementation - Domain-Specific Methods
  // ============================================================================

  /**
   * Get an extraction job by ID (IExtractionJobRepository interface)
   *
   * @param jobId - ExtractionJob identifier
   * @returns Promise resolving to extraction job or null if not found
   */
  async getExtractionJobById(jobId: string): Promise<ExtractionJob | null> {
    return this.getById(jobId);
  }

  /**
   * Get all extraction jobs for a project
   *
   * Uses the dedicated project jobs endpoint which returns jobs
   * with their associated data layers.
   *
   * @param projectId - Project identifier
   * @returns Promise resolving to array of extraction jobs
   */
  async getExtractionJobsByProject(
    projectId: string
  ): Promise<ExtractionJob[]> {
    try {
      const response = await this.adapter.get<{
        extractionJobs: ExtractionJob[];
      }>(`/extraction/project/${projectId}/jobs`);

      const jobs = response.extractionJobs || [];
      this.hydrateEntities(jobs);
      if (this.queryClient) {
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-jobs", "project", projectId]
        });
      }

      return jobs;
    } catch (error) {
      console.error(
        `Error fetching extraction jobs for project ${projectId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get all extraction jobs for a data layer
   *
   * @param dataLayerId - Data layer identifier
   * @returns Promise resolving to array of extraction jobs
   */
  async getExtractionJobsByDataLayer(
    dataLayerId: string
  ): Promise<ExtractionJob[]> {
    return this.getAll({ dataLayerId });
  }

  /**
   * Create a new extraction job with DTO transformation
   *
   * @param data - Extraction job creation data
   * @returns Promise resolving to created extraction job
   */
  async createExtractionJob(
    data: CreateExtractionJobData
  ): Promise<ExtractionJob> {
    // Transform DTO to entity format
    const jobData = {
      organizationId: data.organizationId,
      initiatedBy: data.initiatedBy,
      schemaId: data.schemaId,
      jobType: data.jobType ?? "extraction",
      status: "pending",
      progressPercentage: 0,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      config: data.config ?? {},
      logs: [],
      compiledJsonSchema: data.compiledJsonSchema ?? null,
      meta: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    return this.create(jobData);
  }

  /**
   * Update extraction job status with optional progress and error information
   *
   * @param jobId - ExtractionJob identifier
   * @param status - New status value
   * @param progressPercentage - Optional progress percentage (0-100)
   * @param errorMessage - Optional error message if status is 'failed'
   * @param metadata - Optional metadata to merge with existing meta
   * @returns Promise resolving to updated extraction job
   */
  async updateExtractionJobStatus(
    jobId: string,
    status:
      | "queued"
      | "running"
      | "completed"
      | "completed_with_warnings"
      | "failed"
      | "cancelled",
    progressPercentage?: number,
    errorMessage?: string,
    metadata?: unknown
  ): Promise<ExtractionJob> {
    const updateData: Partial<ExtractionJob> = {
      status,
      ...(progressPercentage !== undefined && { progressPercentage }),
      ...(errorMessage !== undefined && { errorMessage }),
      updatedAt: new Date()
    };

    // Handle status-specific fields
    if (status === "running" && !this.getEntityFromStore(jobId)?.startedAt) {
      updateData.startedAt = new Date();
    }

    if (status === "completed" || status === "failed") {
      updateData.completedAt = new Date();
      updateData.progressPercentage =
        status === "completed" ? 100 : (progressPercentage ?? 0);
    }

    // Merge metadata if provided
    if (metadata) {
      const currentJob = this.getEntityFromStore(jobId);
      updateData.meta = {
        ...(currentJob?.meta as object),
        ...metadata
      };
    }

    return this.update(jobId, updateData);
  }

  /**
   * Append a log entry to an extraction job's logs
   *
   * @param jobId - ExtractionJob identifier
   * @param logEntry - Log entry to append
   * @returns Promise resolving when log is appended
   */
  async appendJobLog(jobId: string, logEntry: any): Promise<void> {
    try {
      await this.adapter.post(`${this.getBasePath()}/${jobId}/logs`, {
        logEntry
      });

      // Fetch updated job to get the new logs array
      const updatedJob = await this.getById(jobId);
      if (updatedJob) {
        this.hydrateEntity(updatedJob);
      }

      // Invalidate cache
      if (this.queryClient) {
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-jobs", jobId]
        });
      }
    } catch (error) {
      console.error(`Error appending log to job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Add a data layer to an extraction job
   *
   * @param jobId - ExtractionJob identifier
   * @param dataLayerId - Data layer identifier
   * @param processingOrder - Order in which to process this data layer
   * @returns Promise resolving when data layer is added
   */
  async addDataLayerToJob(
    jobId: string,
    dataLayerId: string,
    processingOrder: number
  ): Promise<void> {
    try {
      await this.adapter.post(`${this.getBasePath()}/${jobId}/data-layers`, {
        dataLayerId,
        processingOrder
      });

      // Invalidate cache
      if (this.queryClient) {
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-jobs", jobId]
        });
      }
    } catch (error) {
      console.error(`Error adding data layer to job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Update the status of a data layer within an extraction job
   *
   * @param jobId - ExtractionJob identifier
   * @param dataLayerId - Data layer identifier
   * @param status - New status for the data layer
   * @returns Promise resolving when status is updated
   */
  async updateExtractionJobDataLayerStatus(
    jobId: string,
    dataLayerId: string,
    status: "pending" | "processing" | "completed" | "failed"
  ): Promise<void> {
    try {
      await this.adapter.patch(
        `${this.getBasePath()}/${jobId}/data-layers/${dataLayerId}`,
        { status }
      );

      // Invalidate cache
      if (this.queryClient) {
        await this.queryClient.invalidateQueries({
          queryKey: ["extraction-jobs", jobId]
        });
      }
    } catch (error) {
      console.error(
        `Error updating data layer status for job ${jobId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get all data layers associated with an extraction job
   *
   * @param jobId - ExtractionJob identifier
   * @returns Promise resolving to array of data layers
   */
  async getExtractionJobDataLayers(jobId: string): Promise<any[]> {
    try {
      const dataLayers = await this.adapter.get<any[]>(
        `${this.getBasePath()}/${jobId}/data-layers`
      );
      return dataLayers;
    } catch (error) {
      console.error(`Error fetching data layers for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Delete an extraction job (IExtractionJobRepository interface)
   *
   * @param jobId - ExtractionJob identifier
   * @returns Promise resolving when deletion is complete
   */
  async deleteExtractionJob(jobId: string): Promise<void> {
    return this.delete(jobId);
  }

  /**
   * Search extraction results within a job
   *
   * @param jobId - ExtractionJob identifier
   * @param query - Search query string
   * @returns Promise resolving to array of matching extraction results
   */
  async searchExtractionResults(jobId: string, query: string): Promise<any[]> {
    try {
      const results = await this.adapter.get<any[]>(
        `${this.getBasePath()}/${jobId}/results/search`,
        { query }
      );
      return results;
    } catch (error) {
      console.error(
        `Error searching extraction results for job ${jobId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get high-confidence extractions for a job
   *
   * @param jobId - ExtractionJob identifier
   * @param threshold - Minimum confidence score threshold (0-1)
   * @returns Promise resolving to array of high-confidence extraction results
   */
  async getHighConfidenceExtractions(
    jobId: string,
    threshold: number
  ): Promise<any[]> {
    try {
      const results = await this.adapter.get<any[]>(
        `${this.getBasePath()}/${jobId}/results/high-confidence`,
        { threshold }
      );
      return results;
    } catch (error) {
      console.error(
        `Error fetching high-confidence extractions for job ${jobId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get extraction jobs filtered by confidence score
   *
   * @param minConfidence - Minimum confidence score (0-1)
   * @returns Promise resolving to array of extraction jobs
   */
  async getExtractionJobsByConfidenceScore(
    minConfidence: number
  ): Promise<ExtractionJob[]> {
    try {
      const jobs = await this.adapter.get<ExtractionJob[]>(
        `${this.getBasePath()}`,
        { minConfidence }
      );
      return jobs;
    } catch (error) {
      console.error(
        `Error fetching extraction jobs by confidence score:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get extraction jobs filtered by material type
   *
   * @param materialType - Material type to filter by
   * @returns Promise resolving to array of extraction jobs
   */
  async getExtractionJobsByMaterialType(
    materialType: string
  ): Promise<ExtractionJob[]> {
    try {
      const jobs = await this.adapter.get<ExtractionJob[]>(
        `${this.getBasePath()}`,
        { materialType }
      );
      return jobs;
    } catch (error) {
      console.error(`Error fetching extraction jobs by material type:`, error);
      throw error;
    }
  }
}
