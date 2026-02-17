import { Injectable } from "@nestjs/common";
import { CreateRoleData, IRoleRepository, Role } from "@packages/types";
import { ConfigService } from "@/config/config.service";
import { BaseDatabaseService } from "@/shared/database/base-database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

@Injectable()
export class RolesDatabaseService
  extends BaseDatabaseService
  implements IRoleRepository
{
  constructor(prismaService: PrismaService, configService: ConfigService) {
    super(prismaService, configService);
  }

  async getRoleById(roleId: string): Promise<Role | null> {
    this.logger.info(`Fetching role by ID: ${roleId}`, this.context);

    try {
      const role = await this.prisma.role.findUnique({
        where: {
          id: roleId
        }
      });

      if (!role) {
        this.logger.warn(`Role with ID: ${roleId} not found`, this.context);
        return null;
      }

      return role;
    } catch (error) {
      this.logger.error({
        message: `Failed to fetch role ID: ${roleId}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async getRolesByOrganizationId(organizationId: string): Promise<Role[]> {
    this.logger.info(
      `Fetching roles for organization: ${organizationId}`,
      this.context
    );

    try {
      const roles = await this.prisma.role.findMany({
        where: {
          organizationId
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      return roles;
    } catch (error) {
      this.logger.error({
        message: `Failed to fetch roles for organization: ${organizationId}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async getSystemRoles(): Promise<Role[]> {
    this.logger.info("Fetching system roles", this.context);

    try {
      const roles = await this.prisma.role.findMany({
        where: {
          isSystem: true,
          organizationId: null
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      return roles;
    } catch (error) {
      this.logger.error({
        message: "Failed to fetch system roles",
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async getAvailableRoles(organizationId: string): Promise<Role[]> {
    this.logger.info("Fetching available roles", {
      ...this.context,
      organizationId
    });

    try {
      const roles = await this.prisma.role.findMany({
        where: {
          OR: [{ isSystem: true, organizationId: null }, { organizationId }]
        },
        orderBy: [{ isSystem: "desc" }, { name: "asc" }]
      });

      return roles;
    } catch (error) {
      this.logger.error({
        message: "Failed to fetch available roles",
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async createRole(data: CreateRoleData): Promise<Role> {
    this.logger.info(`Creating new role: ${data.name}`, this.context);

    try {
      const createdRole = await this.prisma.role.create({
        data: {
          name: data.name,
          slug: data.slug,
          description: data.description ?? null,
          isSystem: data.isSystem ?? false,
          organizationId: data.organizationId ?? null
        }
      });

      this.logger.info(
        `Role created successfully with ID: ${createdRole.id}`,
        this.context
      );
      return createdRole;
    } catch (error) {
      this.logger.error({
        message: `Failed to create role: ${data.name}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async updateRole(roleId: string, data: Partial<Role>): Promise<Role> {
    this.logger.info(`Updating role ID: ${roleId}`, this.context);

    try {
      const updatedRole = await this.prisma.role.update({
        where: {
          id: roleId
        },
        data: {
          ...(data.name && { name: data.name }),
          ...(data.slug && { slug: data.slug }),
          ...(data.description !== undefined && {
            description: data.description ?? null
          }),
          ...(data.isSystem !== undefined && { isSystem: data.isSystem }),
          ...(data.organizationId !== undefined && {
            organizationId: data.organizationId ?? null
          }),
          updatedAt: new Date()
        }
      });

      this.logger.info(
        `Role updated successfully for ID: ${roleId}`,
        this.context
      );
      return updatedRole;
    } catch (error) {
      this.logger.error({
        message: `Failed to update role ID: ${roleId}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async deleteRole(roleId: string): Promise<void> {
    this.logger.info(`Deleting role ID: ${roleId}`, this.context);

    try {
      await this.prisma.role.delete({
        where: {
          id: roleId
        }
      });

      this.logger.info(
        `Role deleted successfully for ID: ${roleId}`,
        this.context
      );
    } catch (error) {
      this.logger.error({
        message: `Failed to delete role ID: ${roleId}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }
}
