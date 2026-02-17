import { Injectable } from "@nestjs/common";
import { IUserRepository, OrganizationMember, User } from "@packages/types";
import { Prisma } from "@prisma/client";
import { ConfigService } from "@/config/config.service";
import { BaseDatabaseService } from "@/shared/database/base-database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

@Injectable()
export class UsersDatabaseService
  extends BaseDatabaseService
  implements IUserRepository
{
  constructor(prismaService: PrismaService, configService: ConfigService) {
    super(prismaService, configService);
  }

  async getUserById(userId: string): Promise<User | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: {
          id: userId
        }
      });

      if (!user) {
        return null;
      }

      return user;
    } catch (error) {
      this.logger.error({
        message: `Failed to fetch user ID: ${userId}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async getUsersByOrgId(orgUid: string): Promise<User[]> {
    try {
      // Get users through organization membership
      const memberships = await this.prisma.organizationMember.findMany({
        where: {
          organizationId: orgUid,
          status: "active"
        },
        include: {
          user: true
        },
        orderBy: {
          user: {
            createdAt: "desc"
          }
        }
      });

      if (!memberships || memberships.length === 0) {
        return [];
      }

      const users: User[] = memberships.map(
        (membership: { user: User }) => membership.user
      );

      return users;
    } catch (error) {
      this.logger.error({
        message: `Failed to fetch users for organization UID: ${orgUid}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async getUserOrganizationMemberships(
    userId: string
  ): Promise<OrganizationMember[]> {
    try {
      const memberships = await this.prisma.organizationMember.findMany({
        where: {
          userId,
          status: "active"
        },
        include: {
          role: {
            select: {
              id: true,
              name: true,
              slug: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      // Map Prisma result to OrganizationMember type
      return memberships.map((membership) => ({
        id: membership.id,
        organizationId: membership.organizationId,
        userId: membership.userId,
        roleId: membership.roleId,
        status: membership.status,
        joinedAt: membership.joinedAt,
        createdAt: membership.createdAt,
        updatedAt: membership.updatedAt,
        role: membership.role
          ? {
              id: membership.role.id,
              name: membership.role.name,
              slug: membership.role.slug
            }
          : undefined
      }));
    } catch (error) {
      this.logger.error({
        message: `Failed to fetch organization memberships for user: ${userId}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async createUser(user: Omit<User, "id">): Promise<User> {
    try {
      const createdUser = await this.prisma.user.create({
        data: {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl: user.avatarUrl,
          phone: user.phone,
          timezone: user.timezone || "UTC",
          meta: (user.meta as Prisma.JsonValue) || {}
        }
      });

      return createdUser;
    } catch (error) {
      this.logger.error({
        message: `Failed to create user: ${user.email}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async createUserWithId(user: User): Promise<User> {
    try {
      const createdUser = await this.prisma.user.create({
        data: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl: user.avatarUrl,
          phone: user.phone,
          timezone: user.timezone || "UTC",
          meta: (user.meta as Prisma.JsonValue) || {}
        }
      });

      return createdUser;
    } catch (error) {
      this.logger.error({
        message: `Failed to create user with ID: ${user.email}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async updateUser(
    userId: string,
    updates: Partial<Omit<User, "id">>
  ): Promise<User> {
    try {
      const updatedUser = await this.prisma.user.update({
        where: {
          id: userId
        },
        data: {
          ...(updates as Prisma.UserUpdateInput),
          updatedAt: new Date()
        }
      });

      return updatedUser;
    } catch (error) {
      this.logger.error({
        message: `Failed to update user ID: ${userId}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  async deleteUser(userId: string): Promise<void> {
    try {
      await this.prisma.user.delete({
        where: {
          id: userId
        }
      });
    } catch (error) {
      this.logger.error({
        message: `Failed to delete user ID: ${userId}`,
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }
}
