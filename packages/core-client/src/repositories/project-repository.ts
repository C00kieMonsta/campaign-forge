import type {
  CreateProjectData,
  IProjectRepository,
  IWebSocketService,
  Project,
  Supplier,
  UpdateProjectRequest,
  WebSocketPayload
} from "@packages/types";
import { TABLE_NAMES } from "@packages/types";
import {
  removeProject,
  setProject,
  setProjects,
  setSuppliers
} from "../store/slices/entities-slice";
import { setProjectsError } from "../store/slices/ui-slice";
import type { RootState } from "../store/store";
import {
  BaseRepository,
  HotRepositoryDependencies,
  IHotRepository
} from "./base-repository";

/**
 * Repository for managing Project entities with realtime updates
 */
export class ProjectRepository
  extends BaseRepository<Project>
  implements IHotRepository<Project>, IProjectRepository
{
  readonly cacheTTL = 30;

  private readonly wsService: IWebSocketService;
  private subscribed = false;
  private readonly channelName = TABLE_NAMES.PROJECTS;

  constructor(dependencies: HotRepositoryDependencies) {
    super(dependencies);
    this.wsService = dependencies.wsService;
  }

  /**
   * Get the base API path for project endpoints
   */
  protected getBasePath(): string {
    return "/projects";
  }

  /**
   * Get the entity type name for store operations
   */
  protected getEntityType(): keyof RootState["entities"] {
    return "projects";
  }

  /**
   * Dispatch action to set a single project in the store
   */
  protected dispatchSetEntity(
    _entityType: keyof RootState["entities"],
    entity: Project
  ): void {
    this.store.dispatch(setProject(entity));
  }

  /**
   * Dispatch action to set multiple projects in the store
   */
  protected dispatchSetEntities(
    _entityType: keyof RootState["entities"],
    entities: Project[]
  ): void {
    this.store.dispatch(setProjects(entities));
  }

  /**
   * Dispatch action to remove a project from the store
   */
  protected dispatchRemoveEntity(
    _entityType: keyof RootState["entities"],
    id: string
  ): void {
    this.store.dispatch(removeProject(id));
  }

  /**
   * Dispatch action to set error state in the UI slice for projects
   */
  protected dispatchSetError(error: string | null): void {
    this.store.dispatch(setProjectsError(error));
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
          this.hydrateEntity(data as Project);
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

  async getById(id: string): Promise<Project | null> {
    return super.getById(id);
  }

  async getAll(filters?: Record<string, any>): Promise<Project[]> {
    const response = await this.adapter.get<{
      projects: Project[];
      total: number;
      page: number;
      limit: number;
    }>(this.getBasePath(), filters);
    const projects = response?.projects || [];
    this.hydrateEntities(projects);
    return projects;
  }

  async create(data: Omit<Project, "id">): Promise<Project> {
    const project = await this.adapter.post<Project>(this.getBasePath(), data);
    this.hydrateEntity(project);
    return project;
  }

  async update(id: string, data: Partial<Project>): Promise<Project> {
    const project = await this.adapter.patch<Project>(
      `${this.getBasePath()}/${id}`,
      data
    );
    this.hydrateEntity(project);
    return project;
  }

  async delete(id: string): Promise<void> {
    await this.adapter.delete(`${this.getBasePath()}/${id}`);
    this.dispatchRemoveEntity(this.getEntityType(), id);
  }

  async updateOptimistic(id: string, data: Partial<Project>): Promise<Project> {
    return super.updateOptimistic(id, data);
  }

  // ============================================================================
  // IProjectRepository Implementation - Domain-Specific Methods
  // ============================================================================

  /**
   * Get a project by ID (IProjectRepository interface)
   *
   * @param projectId - Project identifier
   * @returns Promise resolving to project or null if not found
   */
  async getProjectById(projectId: string): Promise<Project | null> {
    return this.getById(projectId);
  }

  /**
   * Get all projects for an organization
   *
   * @param organizationId - Organization identifier
   * @returns Promise resolving to array of projects
   */
  async getProjectsByOrganization(organizationId: string): Promise<Project[]> {
    return this.getAll({ organizationId });
  }

  /**
   * Get all projects for a specific client within an organization
   *
   * @param organizationId - Organization identifier
   * @param clientId - Client identifier
   * @returns Promise resolving to array of projects
   */
  async getProjectsByClient(
    organizationId: string,
    clientId: string
  ): Promise<Project[]> {
    return this.getAll({ organizationId, clientId });
  }

  /**
   * Create a new project with DTO transformation
   *
   * @param data - Project creation data including organizationId and createdBy
   * @returns Promise resolving to created project
   */
  async createProject(data: CreateProjectData): Promise<Project> {
    // Transform DTO to entity format
    const projectData = {
      organizationId: data.organizationId,
      clientId: data.clientId,
      name: data.name,
      description: data.description ?? null,
      status: "active" as const,
      location: data.location ?? null,
      meta: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    return this.create(projectData);
  }

  /**
   * Update a project with DTO transformation
   *
   * @param projectId - Project identifier
   * @param data - Project update data
   * @returns Promise resolving to updated project
   */
  async updateProject(
    projectId: string,
    data: UpdateProjectRequest
  ): Promise<Project> {
    // Transform DTO to entity format
    const updateData: Partial<Project> = {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.location !== undefined && { location: data.location }),
      updatedAt: new Date()
    };

    return this.update(projectId, updateData);
  }

  /**
   * Delete a project (IProjectRepository interface)
   *
   * @param projectId - Project identifier
   * @returns Promise resolving when deletion is complete
   */
  async deleteProject(projectId: string): Promise<void> {
    return this.delete(projectId);
  }

  async archiveProjects(projectIds: string[]): Promise<void> {
    await this.adapter.patch<void>(`${this.getBasePath()}/archive`, {
      projectIds
    });
  }

  async restoreProjects(projectIds: string[]): Promise<void> {
    await this.adapter.patch<void>(`${this.getBasePath()}/restore`, {
      projectIds
    });
  }

  async permanentlyDeleteProjects(projectIds: string[]): Promise<void> {
    await this.adapter.post(`${this.getBasePath()}/permanently-delete`, {
      projectIds
    });
    projectIds.forEach((id) => {
      this.store.dispatch(removeProject(id));
    });
  }

  async getProjectsByClientWithPagination(
    organizationId: string,
    clientId: string,
    page: number,
    limit: number
  ): Promise<{ projects: Project[]; total: number }> {
    const response = await this.adapter.get<{
      projects: Project[];
      total: number;
    }>(`${this.getBasePath()}/paginated`, {
      organizationId,
      clientId,
      page,
      limit
    });
    this.hydrateEntities(response.projects);
    return response;
  }

  async getProjectsByOrganizationWithPagination(
    organizationId: string,
    page: number,
    limit: number
  ): Promise<{ projects: Project[]; total: number }> {
    const response = await this.adapter.get<{
      projects: Project[];
      total: number;
    }>(`${this.getBasePath()}/paginated`, {
      organizationId,
      page,
      limit
    });
    this.hydrateEntities(response.projects);
    return response;
  }

  /**
   * Get archived projects for an organization
   *
   * @param organizationId - Organization identifier
   * @returns Promise resolving to array of archived projects
   */
  async getArchivedProjectsByOrganization(
    organizationId: string
  ): Promise<Project[]> {
    return this.getAll({ organizationId, status: "archived" });
  }

  /**
   * Get archived projects for a specific client
   *
   * @param organizationId - Organization identifier
   * @param clientId - Client identifier
   * @returns Promise resolving to array of archived projects
   */
  async getArchivedProjectsByClient(
    organizationId: string,
    clientId: string
  ): Promise<Project[]> {
    return this.getAll({ organizationId, clientId, status: "archived" });
  }

  async getArchivedProjects(clientId: string): Promise<Project[]> {
    const archivedProjects = await this.adapter.get<Project[]>(
      `${this.getBasePath()}/archived`,
      { clientId }
    );
    const projects = Array.isArray(archivedProjects) ? archivedProjects : [];
    this.hydrateEntities(projects);
    return projects;
  }

  async getProjectSuppliers(projectId: string): Promise<{
    project: Project;
    stats: {
      totalItems: number;
      matchedItems: number;
      unmatchedItems: number;
      suppliersFound: number;
    };
    suppliers: Array<{
      supplier: Supplier;
      matchedItems: number;
      totalProjectItems: number;
      matchPercentage: number;
      extractionResults: Array<{
        id: string;
        data: Record<string, unknown>;
        jobId: string;
      }>;
    }>;
  }> {
    const response = await this.adapter.get<{
      project: Project;
      stats: {
        totalItems: number;
        matchedItems: number;
        unmatchedItems: number;
        suppliersFound: number;
      };
      suppliers: Array<{
        supplier: Supplier;
        matchedItems: number;
        totalProjectItems: number;
        matchPercentage: number;
        extractionResults: Array<{
          id: string;
          data: Record<string, unknown>;
          jobId: string;
        }>;
      }>;
    }>(`${this.getBasePath()}/${projectId}/suppliers`);
    this.store.dispatch(
      setSuppliers(response.suppliers.map((item) => item.supplier))
    );
    return response;
  }
}
