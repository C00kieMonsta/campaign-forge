import type {
  DataLayer,
  IWebSocketService,
  WebSocketPayload
} from "@packages/types";
import { TABLE_NAMES } from "@packages/types";
import {
  removeDataLayer,
  setDataLayers
} from "../store/slices/entities-slice";
import type { RootState } from "../store/store";
import {
  BaseRepository,
  HotRepositoryDependencies,
  IHotRepository
} from "./base-repository";

export class DataLayerRepository
  extends BaseRepository<DataLayer>
  implements IHotRepository<DataLayer>
{
  readonly cacheTTL = 30;

  private readonly wsService: IWebSocketService;
  private subscribed = false;
  private readonly channelName = TABLE_NAMES.DATA_LAYERS;

  constructor(dependencies: HotRepositoryDependencies) {
    super(dependencies);
    this.wsService = dependencies.wsService;
  }

  /**
   * Get the base API path for data layer endpoints
   */
  protected getBasePath(): string {
    return "/data_layers";
  }

  /**
   * Get the entity type name for store operations
   */
  protected getEntityType(): keyof RootState["entities"] {
    return "dataLayers";
  }

  /**
   * Dispatch action to set multiple data layers in the store
   */
  protected dispatchSetEntities(
    _entityType: keyof RootState["entities"],
    entities: DataLayer[]
  ): void {
    this.store.dispatch(setDataLayers(entities));
  }

  /**
   * Dispatch action to set a single data layer in the store
   * Note: Using setDataLayers for consistency
   */
  protected dispatchSetEntity(
    _entityType: keyof RootState["entities"],
    entity: DataLayer
  ): void {
    this.store.dispatch(setDataLayers([entity]));
  }

  protected dispatchRemoveEntity(
    _entityType: keyof RootState["entities"],
    id: string
  ): void {
    this.store.dispatch(removeDataLayer(id));
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
          this.hydrateEntity(data as DataLayer);
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

  async getByProject(
    projectId: string
  ): Promise<DataLayer[]> {
    const response = await this.adapter.get<{
      dataLayers: DataLayer[];
      total: number;
      page: number;
      limit: number;
    }>(`${this.getBasePath()}/project/${projectId}`);
    const dataLayers = response.dataLayers || [];
    this.hydrateEntities(dataLayers);
    return dataLayers;
  }

  async getById(dataLayerId: string): Promise<DataLayer | null> {
    return super.getById(dataLayerId);
  }

  async getByOrganization(organizationId: string): Promise<DataLayer[]> {
    const response = await this.adapter.get<DataLayer[]>(
      `${this.getBasePath()}/organization/${organizationId}`
    );
    const dataLayers = Array.isArray(response) ? response : [];
    this.hydrateEntities(dataLayers);
    return dataLayers;
  }
}
