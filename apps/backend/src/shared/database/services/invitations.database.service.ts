import { Injectable } from "@nestjs/common";
import { IInvitationRepository, Invitation } from "@packages/types";
import { ConfigService } from "@/config/config.service";
import { BaseDatabaseService } from "@/shared/database/base-database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

@Injectable()
export class InvitationsDatabaseService
  extends BaseDatabaseService
  implements IInvitationRepository
{
  constructor(prismaService: PrismaService, configService: ConfigService) {
    super(prismaService, configService);
  }

  async createInvitation(data: {
    organizationId: string;
    email: string;
    roleId: string;
    invitedBy: string;
  }): Promise<Invitation> {
    this.logger.info("Creating invitation", {
      ...this.context,
      email: data.email,
      organizationId: data.organizationId
    });

    try {
      const invitation = await this.prisma.invitation.create({
        data: {
          organizationId: data.organizationId,
          email: data.email,
          roleId: data.roleId,
          invitedBy: data.invitedBy,
          status: "pending",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        }
      });

      return invitation as Invitation;
    } catch (error) {
      this.logger.error("Failed to create invitation", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        email: data.email
      });
      throw error;
    }
  }

  async getInvitationsByOrganization(
    organizationId: string
  ): Promise<Invitation[]> {
    this.logger.info("Fetching invitations for organization", {
      ...this.context,
      organizationId
    });

    try {
      const invitations = await this.prisma.invitation.findMany({
        where: {
          organizationId
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      return invitations as Invitation[];
    } catch (error) {
      this.logger.error("Failed to fetch invitations", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        organizationId
      });
      throw error;
    }
  }

  async getInvitationByToken(token: string): Promise<Invitation | null> {
    try {
      const invitation = await this.prisma.invitation.findUnique({
        where: {
          token
        }
      });

      if (!invitation) {
        return null;
      }

      return invitation as Invitation;
    } catch (error) {
      this.logger.error("Failed to get invitation by token", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        token
      });
      throw error;
    }
  }

  async resendInvitation(invitationId: string): Promise<Invitation> {
    try {
      const invitation = await this.prisma.invitation.update({
        where: {
          id: invitationId
        },
        data: {
          updatedAt: new Date(),
          // Extend expiration by another 7 days
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        }
      });

      return invitation as Invitation;
    } catch (error) {
      this.logger.error("Failed to resend invitation", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        invitationId
      });
      throw error;
    }
  }

  async deleteInvitation(invitationId: string): Promise<void> {
    try {
      await this.prisma.invitation.delete({
        where: {
          id: invitationId
        }
      });
    } catch (error) {
      this.logger.error("Failed to delete invitation", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        invitationId
      });
      throw error;
    }
  }

  async updateInvitationStatus(
    invitationId: string,
    status: "pending" | "accepted" | "rejected" | "expired",
    acceptedBy?: string
  ): Promise<Invitation> {
    try {
      const invitation = await this.prisma.invitation.update({
        where: {
          id: invitationId
        },
        data: {
          status,
          acceptedAt: status === "accepted" ? new Date() : null,
          acceptedBy: acceptedBy || null,
          updatedAt: new Date()
        }
      });

      return invitation as Invitation;
    } catch (error) {
      this.logger.error("Failed to update invitation status", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        invitationId,
        status
      });
      throw error;
    }
  }
}
