import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request
} from "@nestjs/common";
import {
  CreateProjectRequestSchema,
  Project,
  ProjectListResponse,
  TABLE_NAMES,
  UpdateProjectRequestSchema
} from "@packages/types";
import type {
  CreateProjectRequest,
  UpdateProjectRequest
} from "@packages/types";
import { Audit } from "@/logger/audit.decorator";
import { ProjectsService } from "@/projects/projects.service";
import { AuthenticatedRequest } from "@/shared/types/request.types";
import { SupplierEmailText } from "@/suppliers/supplier-email.service";

@Controller(TABLE_NAMES.PROJECTS)
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Post()
  @Audit({ action: "create", resource: "project" })
  async createProject(
    @Body() body: CreateProjectRequest,
    @Request() req: AuthenticatedRequest
  ): Promise<Project> {
    const data = CreateProjectRequestSchema.parse(body);
    const user = req.user;

    // For public access during development, use a default organization
    const organizationId = user?.organizationId;
    const userId = user?.id;

    if (!organizationId || !userId) {
      throw new Error("Not valid organization id or user id");
    }

    return this.projectsService.createProject(organizationId, userId, data);
  }

  @Get()
  async getProjects(
    @Query("clientId") clientId: string,
    @Query("page") page: string = "1",
    @Query("limit") limit: string = "10",
    @Request() req: AuthenticatedRequest
  ): Promise<ProjectListResponse> {
    const t0 = performance.now();
    const timings: Record<string, number> = {};

    // For public access during development, use a default organization
    const user = req.user;
    const organizationId = user?.organizationId;

    if (!organizationId) {
      throw new Error("No valid organization id");
    }

    const tDb0 = performance.now();
    const result = await this.projectsService.getProjectsWithPagination(
      organizationId,
      clientId,
      parseInt(page),
      parseInt(limit)
    );
    timings.db = +(performance.now() - tDb0).toFixed(1);

    const tJson0 = performance.now();
    timings.json = +(performance.now() - tJson0).toFixed(1);
    timings.api_total = +(performance.now() - t0).toFixed(1);

    // Add debug timing header
    req.res?.setHeader(
      "X-Debug-Timings",
      Object.entries(timings)
        .map(([k, v]) => `${k}=${v}ms`)
        .join(",")
    );

    return result;
  }

  @Get("archived")
  async getArchivedProjects(
    @Query("clientId") clientId: string,
    @Request() req: AuthenticatedRequest
  ): Promise<Project[]> {
    const user = req.user;
    const organizationId = user?.organizationId;

    if (!organizationId) {
      throw new Error("No valid organization Id");
    }

    return this.projectsService.getArchivedProjects(organizationId, clientId);
  }

  @Get(":projectId/suppliers")
  @Audit({ action: "get_suppliers", resource: "project" })
  async getProjectSuppliers(
    @Param("projectId") projectId: string,
    @Request() req: AuthenticatedRequest
  ) {
    const user = req.user;
    const organizationId = user?.organizationId;

    if (!organizationId) {
      throw new Error("No valid organization Id");
    }

    return this.projectsService.getProjectSuppliers(projectId, organizationId);
  }

  @Get(":projectId/suppliers/:supplierId/email")
  @Audit({ action: "generate_supplier_email", resource: "project" })
  async getSupplierEmail(
    @Param("projectId") projectId: string,
    @Param("supplierId") supplierId: string,
    @Query("dataFields") dataFields: string | undefined,
    @Query("metaFields") metaFields: string | undefined,
    @Request() req: AuthenticatedRequest
  ): Promise<SupplierEmailText> {
    const user = req.user;

    if (!user?.organizationId) {
      throw new HttpException(
        "User is not associated with any organization",
        HttpStatus.FORBIDDEN
      );
    }

    try {
      const parsedDataFields =
        typeof dataFields === "string" && dataFields.trim().length > 0
          ? dataFields
              .split(",")
              .map((field) => field.trim())
              .filter(Boolean)
          : undefined;

      const parsedMetaFields =
        typeof metaFields === "string" && metaFields.trim().length > 0
          ? metaFields
              .split(",")
              .map((field) => field.trim())
              .filter(Boolean)
          : undefined;

      return await this.projectsService.generateSupplierEmail(
        projectId,
        supplierId,
        user.organizationId,
        {
          dataFields: parsedDataFields,
          metaFields: parsedMetaFields
        }
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        error instanceof Error
          ? error.message
          : "Failed to generate supplier email",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(":id")
  async getProject(@Param("id") projectId: string): Promise<Project | null> {
    return this.projectsService.getProjectById(projectId);
  }

  @Put(":id")
  @Audit({ action: "update", resource: "project" })
  async updateProject(
    @Param("id") projectId: string,
    @Body() body: UpdateProjectRequest
  ): Promise<Project> {
    const data = UpdateProjectRequestSchema.parse(body);
    return this.projectsService.updateProject(projectId, data);
  }

  @Patch("archive")
  @Audit({ action: "archive", resource: "projects" })
  async archiveProjects(@Body() body: { projectIds: string[] }): Promise<void> {
    return this.projectsService.archiveProjects(body.projectIds);
  }

  @Patch("restore")
  @Audit({ action: "restore", resource: "projects" })
  async restoreProjects(@Body() body: { projectIds: string[] }): Promise<void> {
    return this.projectsService.restoreProjects(body.projectIds);
  }

  @Delete("permanent")
  @Audit({ action: "permanent_delete", resource: "projects" })
  async permanentlyDeleteProjects(
    @Body() body: { projectIds: string[] }
  ): Promise<void> {
    return this.projectsService.permanentlyDeleteProjects(body.projectIds);
  }

  @Delete(":id")
  @Audit({ action: "delete", resource: "project" })
  async deleteProject(@Param("id") projectId: string): Promise<void> {
    return this.projectsService.deleteProject(projectId);
  }
}
