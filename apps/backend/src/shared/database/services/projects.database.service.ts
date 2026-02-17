import { Injectable } from "@nestjs/common";
import {
  CreateProjectData,
  IProjectRepository,
  Project,
  RESOURCE_STATUSES,
  UpdateProjectRequest
} from "@packages/types";
import { Prisma } from "@prisma/client";
import { ConfigService } from "@/config/config.service";
import { BaseDatabaseService } from "@/shared/database/base-database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

@Injectable()
export class ProjectsDatabaseService
  extends BaseDatabaseService
  implements IProjectRepository
{
  constructor(prismaService: PrismaService, configService: ConfigService) {
    super(prismaService, configService);
  }
  async createProject(data: CreateProjectData): Promise<Project> {
    this.logger.info("Creating new project", {
      ...this.context,
      projectName: data.name,
      organizationId: data.organizationId,
      clientId: data.clientId
    });

    try {
      // First, verify that the client exists and belongs to the organization
      const client = await this.prisma.client.findFirst({
        where: {
          id: data.clientId,
          organizationId: data.organizationId
        }
      });

      if (!client) {
        throw new Error(
          `Client with ID ${data.clientId} not found in organization ${data.organizationId}`
        );
      }

      const project = await this.prisma.project.create({
        data: {
          organizationId: data.organizationId,
          clientId: data.clientId,
          name: data.name,
          description: data.description,
          location: data.location || {},
          status: "active"
        },
        include: {
          client: {
            select: { id: true, name: true }
          }
        }
      });

      return project as Project;
    } catch (error) {
      this.logger.error("Failed to create project", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        clientId: data.clientId,
        organizationId: data.organizationId
      });
      throw new Error(
        `Failed to create project: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getProjectById(projectId: string): Promise<Project | null> {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        include: {
          client: {
            select: { id: true, name: true }
          }
        }
      });

      return project as unknown as Project | null;
    } catch (error) {
      this.logger.error("Failed to get project", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to get project: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getProjectsByOrganization(organizationId: string): Promise<Project[]> {
    try {
      const projects = await this.prisma.project.findMany({
        where: {
          organizationId,
          status: {
            notIn: [RESOURCE_STATUSES.DELETED, RESOURCE_STATUSES.ARCHIVED]
          }
        },
        include: {
          client: {
            select: { id: true, name: true }
          }
        },
        orderBy: { createdAt: "desc" }
      });

      return projects as unknown as Project[];
    } catch (error) {
      this.logger.error("Failed to get projects", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to get projects: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getProjectsByClient(
    organizationId: string,
    clientId: string
  ): Promise<Project[]> {
    try {
      const projects = await this.prisma.project.findMany({
        where: {
          organizationId,
          clientId,
          status: {
            notIn: [RESOURCE_STATUSES.DELETED, RESOURCE_STATUSES.ARCHIVED]
          }
        },
        include: {
          client: {
            select: { id: true, name: true }
          }
        },
        orderBy: { createdAt: "desc" }
      });

      return projects as unknown as Project[];
    } catch (error) {
      this.logger.error("Failed to get client projects", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to get client projects: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getProjectsByClientWithPagination(
    organizationId: string,
    clientId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{ projects: Project[]; total: number }> {
    try {
      const skip = (page - 1) * limit;

      const [projects, total] = await Promise.all([
        this.prisma.project.findMany({
          where: {
            organizationId,
            clientId,
            status: {
              notIn: [RESOURCE_STATUSES.DELETED, RESOURCE_STATUSES.ARCHIVED]
            }
          },
          include: {
            client: {
              select: { id: true, name: true }
            }
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit
        }),
        this.prisma.project.count({
          where: {
            organizationId,
            clientId,
            status: {
              notIn: [RESOURCE_STATUSES.DELETED, RESOURCE_STATUSES.ARCHIVED]
            }
          }
        })
      ]);

      return {
        projects: projects as unknown as Project[],
        total
      };
    } catch (error) {
      this.logger.error("Failed to get client projects with pagination", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to get client projects with pagination: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getProjectsByOrganizationWithPagination(
    organizationId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{ projects: Project[]; total: number }> {
    try {
      const skip = (page - 1) * limit;

      const [projects, total] = await Promise.all([
        this.prisma.project.findMany({
          where: {
            organizationId,
            status: {
              notIn: [RESOURCE_STATUSES.DELETED, RESOURCE_STATUSES.ARCHIVED]
            }
          },
          include: {
            client: {
              select: { id: true, name: true }
            }
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit
        }),
        this.prisma.project.count({
          where: {
            organizationId,
            status: {
              notIn: [RESOURCE_STATUSES.DELETED, RESOURCE_STATUSES.ARCHIVED]
            }
          }
        })
      ]);

      return {
        projects: projects as unknown as Project[],
        total
      };
    } catch (error) {
      this.logger.error("Failed to get organization projects with pagination", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to get organization projects with pagination: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async updateProject(
    projectId: string,
    data: UpdateProjectRequest
  ): Promise<Project> {
    try {
      const updateData: any = {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description ?? null
        }),
        ...(data.status && { status: data.status }),
        updatedAt: new Date()
      };

      if (data.location !== undefined) {
        updateData.location =
          data.location === null
            ? Prisma.JsonNull
            : (data.location as Prisma.InputJsonValue);
      }

      const project = await this.prisma.project.update({
        where: { id: projectId },
        data: updateData,
        include: {
          client: {
            select: { id: true, name: true }
          }
        }
      });

      return project as Project;
    } catch (error) {
      this.logger.error("Failed to update project", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to update project: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    try {
      await this.prisma.project.update({
        where: { id: projectId },
        data: { status: "deleted" }
      });
    } catch (error) {
      this.logger.error("Failed to delete project", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to delete project: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async archiveProjects(projectIds: string[]): Promise<void> {
    try {
      await this.prisma.project.updateMany({
        where: {
          id: { in: projectIds },
          status: { not: RESOURCE_STATUSES.DELETED }
        },
        data: { status: RESOURCE_STATUSES.ARCHIVED }
      });
    } catch (error) {
      this.logger.error("Failed to archive projects", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        projectIds
      });
      throw new Error(
        `Failed to archive projects: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async restoreProjects(projectIds: string[]): Promise<void> {
    try {
      await this.prisma.project.updateMany({
        where: {
          id: { in: projectIds },
          status: RESOURCE_STATUSES.ARCHIVED
        },
        data: { status: "active" }
      });
    } catch (error) {
      this.logger.error("Failed to restore projects", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        projectIds
      });
      throw new Error(
        `Failed to restore projects: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async permanentlyDeleteProjects(projectIds: string[]): Promise<void> {
    try {
      await this.prisma.project.deleteMany({
        where: {
          id: { in: projectIds },
          status: RESOURCE_STATUSES.ARCHIVED
        }
      });
    } catch (error) {
      this.logger.error("Failed to permanently delete projects", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        projectIds
      });
      throw new Error(
        `Failed to permanently delete projects: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getArchivedProjectsByOrganization(
    organizationId: string
  ): Promise<Project[]> {
    try {
      const projects = await this.prisma.project.findMany({
        where: {
          organizationId,
          status: RESOURCE_STATUSES.ARCHIVED
        },
        include: {
          client: {
            select: { id: true, name: true }
          }
        },
        orderBy: { updatedAt: "desc" }
      });

      return projects as unknown as Project[];
    } catch (error) {
      this.logger.error("Failed to get archived projects", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to get archived projects: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getArchivedProjectsByClient(
    organizationId: string,
    clientId: string
  ): Promise<Project[]> {
    try {
      const projects = await this.prisma.project.findMany({
        where: {
          organizationId,
          clientId,
          status: RESOURCE_STATUSES.ARCHIVED
        },
        include: {
          client: {
            select: { id: true, name: true }
          }
        },
        orderBy: { updatedAt: "desc" }
      });

      return projects as unknown as Project[];
    } catch (error) {
      this.logger.error("Failed to get archived client projects", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to get archived client projects: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
