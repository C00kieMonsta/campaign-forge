import type {
  CreateExtractionSchemaData,
  ExtractionSchema,
  IExtractionSchemaRepository,
  IWebSocketService,
  WebSocketPayload
} from "@packages/types";
import {
  removeExtractionSchema,
  setExtractionSchema,
  setExtractionSchemas
} from "../store/slices/entities-slice";
import type { RootState } from "../store/store";
import {
  BaseRepository,
  HotRepositoryDependencies,
  IHotRepository
} from "./base-repository";

export class ExtractionSchemaRepository
  extends BaseRepository<ExtractionSchema>
  implements IHotRepository<ExtractionSchema>, IExtractionSchemaRepository
{
  readonly cacheTTL = 30;

  private readonly wsService: IWebSocketService;
  private subscribed = false;
  private readonly channelName = "extraction_schemas";

  constructor(dependencies: HotRepositoryDependencies) {
    super(dependencies);
    this.wsService = dependencies.wsService;
  }

  /**
   * Get the base API path for extraction schema endpoints
   */
  protected getBasePath(): string {
    return "/extraction/schemas";
  }

  /**
   * Get the entity type name for store operations
   */
  protected getEntityType(): keyof RootState["entities"] {
    return "extractionSchemas";
  }

  /**
   * Dispatch action to set multiple extraction schemas in the store
   */
  protected dispatchSetEntities(
    _entityType: keyof RootState["entities"],
    entities: ExtractionSchema[]
  ): void {
    this.store.dispatch(setExtractionSchemas(entities));
  }

  /**
   * Dispatch action to set a single extraction schema in the store
   */
  protected dispatchSetEntity(
    _entityType: keyof RootState["entities"],
    entity: ExtractionSchema
  ): void {
    this.store.dispatch(setExtractionSchema(entity));
  }

  protected dispatchRemoveEntity(
    _entityType: keyof RootState["entities"],
    id: string
  ): void {
    this.store.dispatch(removeExtractionSchema(id));
  }

  // ============================================================================
  // IHotRepository Implementation - WebSocket Subscription
  // ============================================================================

  subscribe(): void {
    if (this.subscribed) return;
    this.wsService.subscribe(this.channelName, this.handleWebSocketMessage);
    this.subscribed = true;
  }

  unsubscribe(): void {
    if (!this.subscribed) return;
    this.wsService.unsubscribe(this.channelName, this.handleWebSocketMessage);
    this.subscribed = false;
  }

  isSubscribed(): boolean {
    return this.subscribed;
  }

  private handleWebSocketMessage = (payload: WebSocketPayload): void => {
    try {
      const { op } = payload;
      const data = payload.new || payload.old;

      if (!data || typeof data !== "object" || !("id" in data)) {
        console.warn("WebSocket payload missing valid data:", payload);
        return;
      }

      switch (op) {
        case "INSERT":
        case "UPDATE":
          this.hydrateEntity(data as ExtractionSchema);
          break;
        case "DELETE":
          this.dispatchRemoveEntity(this.getEntityType(), data.id as string);
          break;
        default:
          console.warn(`Unknown WebSocket operation: ${op}`);
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
    }
  };

  destroy(): void {
    this.unsubscribe();
  }

  // ============================================================================
  // Base Repository Overrides
  // ============================================================================

  async getAllSchemas(): Promise<ExtractionSchema[]> {
    const response = await this.adapter.get<ExtractionSchema[]>(
      this.getBasePath()
    );
    const schemas = Array.isArray(response) ? response : [];
    this.hydrateEntities(schemas);
    return schemas;
  }

  async getSchemaById(schemaId: string): Promise<ExtractionSchema | null> {
    const response = await this.adapter.get<ExtractionSchema>(
      `${this.getBasePath()}/${schemaId}`
    );
    if (response) {
      this.hydrateEntity(response);
    }
    return response || null;
  }

  async getSchemaVersions(
    schemaIdentifier: string
  ): Promise<ExtractionSchema[]> {
    const response = await this.adapter.get<ExtractionSchema[]>(
      `${this.getBasePath()}/identifier/${schemaIdentifier}/versions`
    );
    const schemas = Array.isArray(response) ? response : [];
    this.hydrateEntities(schemas);
    return schemas;
  }

  async getSchemaJobCount(schemaIdentifier: string): Promise<number> {
    const response = await this.adapter.get<{ count: number }>(
      `${this.getBasePath()}/identifier/${schemaIdentifier}/job-count`
    );
    return response.count || 0;
  }

  async deleteSchema(schemaId: string): Promise<{ deletedJobsCount: number }> {
    const response = await this.adapter.delete<{ deletedJobsCount: number }>(
      `${this.getBasePath()}/${schemaId}`
    );
    this.store.dispatch(removeExtractionSchema(schemaId));
    return response;
  }

  async restoreSchemaVersion(
    schemaId: string,
    versionData: {
      name: string;
      definition: Record<string, unknown>;
      prompt?: string | null;
      examples?: Record<string, unknown>[] | null;
      agents?: unknown[] | null;
      changeDescription?: string;
    }
  ): Promise<ExtractionSchema> {
    const response = await this.adapter.post<ExtractionSchema>(
      `${this.getBasePath()}/${schemaId}/versions`,
      versionData
    );
    this.hydrateEntity(response);
    return response;
  }

  /**
   * Find extraction schema by ID
   */
  async findById(schemaId: string): Promise<ExtractionSchema | null> {
    return this.getSchemaById(schemaId);
  }

  /**
   * Find many extraction schemas for organization
   */
  async findMany(_organizationId: string): Promise<ExtractionSchema[]> {
    // Note: organizationId filter is handled server-side
    return this.getAllSchemas();
  }

  /**
   * Find extraction schemas by identifier
   */
  async findByIdentifier(
    organizationId: string,
    schemaIdentifier: string
  ): Promise<ExtractionSchema[]> {
    // Note: organizationId is passed but the API handles org context via auth
    return this.getSchemaVersions(schemaIdentifier);
  }

  async create(
    data: CreateExtractionSchemaData | Omit<ExtractionSchema, "id">
  ): Promise<ExtractionSchema> {
    const response = await this.adapter.post<ExtractionSchema>(
      this.getBasePath(),
      data
    );
    this.hydrateEntity(response);
    return response;
  }

  async update(
    schemaId: string,
    data: Partial<ExtractionSchema>
  ): Promise<ExtractionSchema> {
    const response = await this.adapter.put<ExtractionSchema>(
      `${this.getBasePath()}/${schemaId}`,
      data
    );
    this.hydrateEntity(response);
    return response;
  }

  async delete(schemaId: string): Promise<void> {
    return this.deleteSchema(schemaId).then(() => undefined);
  }
}
