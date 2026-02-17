import { Injectable } from "@nestjs/common";
import {
  CreateOrganizationRequest,
  IOrganizationRepository,
  Organization,
  UpdateOrganizationRequest
} from "@packages/types";
import { ConfigService } from "@/config/config.service";
import { BaseDatabaseService } from "@/shared/database/base-database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

@Injectable()
export class OrganizationsDatabaseService
  extends BaseDatabaseService
  implements IOrganizationRepository
{
  constructor(prismaService: PrismaService, configService: ConfigService) {
    super(prismaService, configService);
  }

  async getOrganizationById(orgId: string): Promise<Organization | null> {
    try {
      const organization = await this.prisma.organization.findUnique({
        where: {
          id: orgId
        }
      });

      if (!organization) {
        return null;
      }

      return organization;
    } catch (error) {
      this.logger.error({
        message: `Failed to fetch organization ID: ${orgId}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | null> {
    this.logger.info(`Fetching organization by slug: ${slug}`, this.context);

    try {
      const organization = await this.prisma.organization.findUnique({
        where: {
          slug
        }
      });

      if (!organization) {
        this.logger.warn(
          `Organization with slug: ${slug} not found`,
          this.context
        );
        return null;
      }

      this.logger.info(
        `Organization data retrieved for slug: ${slug}`,
        this.context
      );
      return organization;
    } catch (error) {
      this.logger.error({
        message: `Failed to fetch organization slug: ${slug}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async createOrganization(
    data: CreateOrganizationRequest
  ): Promise<Organization> {
    this.logger.info(`Creating new organization: ${data.name}`, this.context);

    try {
      const createdOrg = await this.prisma.organization.create({
        data: {
          name: data.name,
          slug: data.slug,
          description: data.description ?? null,
          meta: {}
        }
      });

      this.logger.info(
        `Organization created successfully with ID: ${createdOrg.id}`,
        this.context
      );
      return createdOrg;
    } catch (error) {
      this.logger.error({
        message: `Failed to create organization: ${data.name}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async updateOrganization(
    organizationId: string,
    data: UpdateOrganizationRequest
  ): Promise<Organization> {
    this.logger.info(
      `Updating organization ID: ${organizationId}`,
      this.context
    );

    try {
      const updatedOrg = await this.prisma.organization.update({
        where: {
          id: organizationId
        },
        data: {
          ...(data.name && { name: data.name }),
          ...(data.slug && { slug: data.slug }),
          ...(data.description !== undefined && {
            description: data.description ?? null
          }),
          updatedAt: new Date()
        }
      });

      this.logger.info(
        `Organization updated successfully for ID: ${organizationId}`,
        this.context
      );
      return updatedOrg;
    } catch (error) {
      this.logger.error({
        message: `Failed to update organization ID: ${organizationId}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async deleteOrganization(orgId: string): Promise<void> {
    this.logger.info(`Deleting organization ID: ${orgId}`, this.context);

    try {
      await this.prisma.organization.delete({
        where: {
          id: orgId
        }
      });

      this.logger.info(
        `Organization deleted successfully for ID: ${orgId}`,
        this.context
      );
    } catch (error) {
      this.logger.error({
        message: `Failed to delete organization ID: ${orgId}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async getAllOrganizations(): Promise<Organization[]> {
    this.logger.info("Fetching all organizations", this.context);

    try {
      const organizations = await this.prisma.organization.findMany({
        orderBy: {
          createdAt: "desc"
        }
      });

      return organizations;
    } catch (error) {
      this.logger.error({
        message: "Failed to fetch all organizations",
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }
}
