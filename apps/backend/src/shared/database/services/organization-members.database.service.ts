import { Injectable } from "@nestjs/common";
import {
  CreateOrganizationMemberData,
  IOrganizationMemberRepository,
  OrganizationMember
} from "@packages/types";
import { ConfigService } from "@/config/config.service";
import { BaseDatabaseService } from "@/shared/database/base-database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

@Injectable()
export class OrganizationMembersDatabaseService
  extends BaseDatabaseService
  implements IOrganizationMemberRepository
{
  constructor(prismaService: PrismaService, configService: ConfigService) {
    super(prismaService, configService);
  }

  async getOrganizationMembers(
    organizationId: string
  ): Promise<OrganizationMember[]> {
    this.logger.info("Fetching organization members", {
      ...this.context,
      organizationId
    });

    try {
      const members = await this.prisma.organizationMember.findMany({
        where: {
          organizationId
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
              timezone: true,
              avatarUrl: true,
              createdAt: true,
              updatedAt: true
            }
          },
          role: {
            select: {
              id: true,
              name: true,
              slug: true
            }
          }
        },
        orderBy: {
          joinedAt: "desc"
        }
      });

      return members as OrganizationMember[];
    } catch (error) {
      this.logger.error("Failed to fetch organization members", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        organizationId
      });
      throw new Error(
        `Failed to fetch organization members: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getOrganizationMemberById(
    memberId: string
  ): Promise<OrganizationMember | null> {
    try {
      const member = await this.prisma.organizationMember.findUnique({
        where: {
          id: memberId
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
              timezone: true,
              avatarUrl: true,
              createdAt: true,
              updatedAt: true
            }
          },
          role: {
            select: {
              id: true,
              name: true,
              slug: true
            }
          }
        }
      });

      if (!member) {
        return null;
      }

      return member as OrganizationMember | null;
    } catch (error) {
      this.logger.error("Failed to get organization member", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        memberId
      });
      throw new Error(
        `Failed to get organization member: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async addOrganizationMember(
    data: CreateOrganizationMemberData
  ): Promise<OrganizationMember> {
    this.logger.info("Adding organization member", {
      ...this.context,
      organizationId: data.organizationId,
      userId: data.userId,
      roleId: data.roleId
    });

    try {
      const member = await this.prisma.organizationMember.create({
        data: {
          organizationId: data.organizationId,
          userId: data.userId,
          roleId: data.roleId,
          status: "active"
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
              timezone: true,
              avatarUrl: true,
              createdAt: true,
              updatedAt: true
            }
          },
          role: {
            select: {
              id: true,
              name: true,
              slug: true
            }
          }
        }
      });

      return member as OrganizationMember;
    } catch (error) {
      this.logger.error("Failed to add organization member", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        organizationId: data.organizationId,
        userId: data.userId,
        roleId: data.roleId
      });
      throw new Error(
        `Failed to add organization member: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async updateOrganizationMemberRole(
    memberId: string,
    roleId: string
  ): Promise<OrganizationMember> {
    try {
      const member = await this.prisma.organizationMember.update({
        where: {
          id: memberId
        },
        data: {
          roleId,
          updatedAt: new Date()
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
              timezone: true,
              avatarUrl: true,
              createdAt: true,
              updatedAt: true
            }
          },
          role: {
            select: {
              id: true,
              name: true,
              slug: true
            }
          }
        }
      });

      return member as OrganizationMember;
    } catch (error) {
      this.logger.error("Failed to update organization member role", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        memberId,
        roleId
      });
      throw new Error(
        `Failed to update organization member role: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async updateOrganizationMemberStatus(
    memberId: string,
    status: "active" | "inactive" | "suspended"
  ): Promise<OrganizationMember> {
    try {
      const member = await this.prisma.organizationMember.update({
        where: {
          id: memberId
        },
        data: {
          status,
          updatedAt: new Date()
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
              timezone: true,
              avatarUrl: true,
              createdAt: true,
              updatedAt: true
            }
          },
          role: {
            select: {
              id: true,
              name: true,
              slug: true
            }
          }
        }
      });

      return member as OrganizationMember;
    } catch (error) {
      this.logger.error("Failed to update organization member status", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        memberId,
        status
      });
      throw new Error(
        `Failed to update organization member status: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async removeOrganizationMember(memberId: string): Promise<void> {
    try {
      await this.prisma.organizationMember.delete({
        where: {
          id: memberId
        }
      });
    } catch (error) {
      this.logger.error("Failed to remove organization member", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        memberId
      });
      throw new Error(
        `Failed to remove organization member: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
