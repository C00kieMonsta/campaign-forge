import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import {
  CreateProjectRequest,
  Project,
  ProjectListResponse,
  Supplier,
  UpdateProjectRequest
} from "@packages/types";
import { ProjectsDatabaseService } from "@/shared/database/services/projects.database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";
import {
  SupplierEmailService,
  SupplierEmailText
} from "@/suppliers/supplier-email.service";

@Injectable()
export class ProjectsService {
  constructor(
    private projectsDb: ProjectsDatabaseService,
    private prisma: PrismaService,
    private supplierEmailService: SupplierEmailService
  ) {}

  async createProject(
    organizationId: string,
    userId: string,
    data: CreateProjectRequest
  ): Promise<Project> {
    return this.projectsDb.createProject({
      ...data,
      organizationId,
      createdBy: userId
    });
  }

  async getProjectById(projectId: string): Promise<Project | null> {
    return this.projectsDb.getProjectById(projectId);
  }

  async getProjectsByOrganization(organizationId: string): Promise<Project[]> {
    return this.projectsDb.getProjectsByOrganization(organizationId);
  }

  async getProjectsByClient(
    organizationId: string,
    clientId: string
  ): Promise<Project[]> {
    return this.projectsDb.getProjectsByClient(organizationId, clientId);
  }

  async updateProject(
    projectId: string,
    data: UpdateProjectRequest
  ): Promise<Project> {
    return this.projectsDb.updateProject(projectId, data);
  }

  async deleteProject(projectId: string): Promise<void> {
    return this.projectsDb.deleteProject(projectId);
  }

  async getProjectsWithPagination(
    organizationId: string,
    clientId?: string,
    page: number = 1,
    limit: number = 10
  ): Promise<ProjectListResponse> {
    const { projects, total } = clientId
      ? await this.projectsDb.getProjectsByClientWithPagination(
          organizationId,
          clientId,
          page,
          limit
        )
      : await this.projectsDb.getProjectsByOrganizationWithPagination(
          organizationId,
          page,
          limit
        );

    return {
      projects,
      total,
      page,
      limit
    };
  }

  async archiveProjects(projectIds: string[]): Promise<void> {
    return this.projectsDb.archiveProjects(projectIds);
  }

  async restoreProjects(projectIds: string[]): Promise<void> {
    return this.projectsDb.restoreProjects(projectIds);
  }

  async permanentlyDeleteProjects(projectIds: string[]): Promise<void> {
    return this.projectsDb.permanentlyDeleteProjects(projectIds);
  }

  async getArchivedProjects(
    organizationId: string,
    clientId?: string
  ): Promise<Project[]> {
    return clientId
      ? this.projectsDb.getArchivedProjectsByClient(organizationId, clientId)
      : this.projectsDb.getArchivedProjectsByOrganization(organizationId);
  }

  async getProjectSuppliers(projectId: string, organizationId: string) {
    // Get the project
    const project = await this.projectsDb.getProjectById(projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    // Verify project belongs to organization
    if (project.organizationId !== organizationId) {
      throw new Error("Project does not belong to organization");
    }

    // Get all extraction jobs for this project through DataLayer relationship
    const extractionJobDataLayers =
      await this.prisma.client.extractionJobDataLayer.findMany({
        where: {
          dataLayer: {
            projectId: projectId
          }
        },
        select: {
          extractionJobId: true
        },
        distinct: ["extractionJobId"]
      });

    if (extractionJobDataLayers.length === 0) {
      return {
        project,
        stats: {
          totalItems: 0,
          matchedItems: 0,
          unmatchedItems: 0,
          suppliersFound: 0
        },
        suppliers: []
      };
    }

    const jobIds = extractionJobDataLayers.map(
      (jdl: { extractionJobId: string }) => jdl.extractionJobId
    );

    // Get all extraction results for these jobs with their supplier matches
    // First, let's check ALL matches to debug
    const allMatches = await this.prisma.client.supplierMatch.findMany({
      where: {
        extractionResult: {
          extractionJobId: { in: jobIds }
        }
      },
      select: {
        id: true,
        extractionResultId: true,
        supplierId: true,
        isSelected: true
      }
    });

    const extractionResults =
      await this.prisma.client.extractionResult.findMany({
        where: {
          extractionJobId: { in: jobIds }
        },
        include: {
          supplierMatches: {
            where: { isSelected: true },
            include: {
              supplier: {
                select: {
                  id: true,
                  name: true,
                  contactName: true,
                  contactEmail: true,
                  contactPhone: true,
                  address: true,
                  materialsOffered: true,
                  meta: true
                }
              }
            }
          }
        }
      });

    // Don't log diagnostics - not helpful for users

    // Calculate stats
    const totalItems = extractionResults.length;
    const matchedItems = extractionResults.filter(
      (r: { supplierMatches?: Array<unknown> }) =>
        r.supplierMatches && r.supplierMatches.length > 0
    ).length;
    const unmatchedItems = totalItems - matchedItems;

    // Group results by supplier
    const supplierMap = new Map<
      string,
      {
        supplier: Supplier;
        extractionResults: Array<{
          id: string;
          data: Record<string, unknown>;
          jobId: string;
        }>;
      }
    >();

    extractionResults.forEach((result: any) => {
      if (result.supplierMatches && result.supplierMatches.length > 0) {
        const match = result.supplierMatches[0]; // Only one selected match per result
        const supplierId = match.supplier.id;

        if (!supplierMap.has(supplierId)) {
          supplierMap.set(supplierId, {
            supplier: match.supplier,
            extractionResults: []
          });
        }

        supplierMap.get(supplierId)!.extractionResults.push({
          id: result.id,
          data: result.verifiedData || result.rawExtraction,
          jobId: result.extractionJobId
        });
      }
    });

    // Convert map to array and calculate match statistics
    const suppliers = Array.from(supplierMap.values()).map((entry) => ({
      supplier: entry.supplier,
      matchedItems: entry.extractionResults.length,
      totalProjectItems: totalItems,
      matchPercentage:
        totalItems > 0
          ? Math.round((entry.extractionResults.length / totalItems) * 100)
          : 0,
      extractionResults: entry.extractionResults
    }));

    return {
      project,
      stats: {
        totalItems,
        matchedItems,
        unmatchedItems,
        suppliersFound: suppliers.length
      },
      suppliers
    };
  }

  async generateSupplierEmail(
    projectId: string,
    supplierId: string,
    organizationId: string,
    options?: {
      dataFields?: string[];
      metaFields?: string[];
    }
  ): Promise<SupplierEmailText> {
    const project = await this.projectsDb.getProjectById(projectId);

    if (!project) {
      throw new HttpException("Project not found", HttpStatus.NOT_FOUND);
    }

    if (project.organizationId !== organizationId) {
      throw new HttpException(
        "Project does not belong to organization",
        HttpStatus.FORBIDDEN
      );
    }

    const extractionJobDataLayers =
      await this.prisma.client.extractionJobDataLayer.findMany({
        where: {
          dataLayer: {
            projectId
          }
        },
        select: {
          extractionJobId: true
        },
        distinct: ["extractionJobId"]
      });

    if (extractionJobDataLayers.length === 0) {
      throw new HttpException(
        "No extraction jobs found for project",
        HttpStatus.NOT_FOUND
      );
    }

    const jobIds = extractionJobDataLayers.map(
      (jdl: { extractionJobId: string }) => jdl.extractionJobId
    );

    const extractionResults =
      await this.prisma.client.extractionResult.findMany({
        where: {
          extractionJobId: { in: jobIds }
        },
        include: {
          supplierMatches: {
            where: { isSelected: true, supplierId },
            include: {
              supplier: true
            }
          }
        }
      });

    const matchedResults = extractionResults.filter(
      (result: { supplierMatches: Array<unknown> }) =>
        result.supplierMatches.length > 0
    );

    if (matchedResults.length === 0) {
      throw new HttpException(
        "No matched items found for supplier",
        HttpStatus.NOT_FOUND
      );
    }

    const supplier = matchedResults[0].supplierMatches[0].supplier as Supplier;

    const supplierExtractionResults = matchedResults.map(
      (result: {
        id: string;
        extractionJobId: string | null;
        verifiedData: unknown;
        rawExtraction: unknown;
      }) => ({
        id: result.id,
        jobId: result.extractionJobId ?? undefined,
        data: result.verifiedData || result.rawExtraction
      })
    );

    return this.supplierEmailService.generateEmailForSupplier(
      supplier,
      supplierExtractionResults,
      options
    );
  }
}
