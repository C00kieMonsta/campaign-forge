import { Injectable } from "@nestjs/common";
import { TABLE_NAMES, type Invitation } from "@packages/types";
import { ConfigService } from "@/config/config.service";
import { BaseDatabaseService } from "@/shared/database/base-database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

@Injectable()
export class InvitationService extends BaseDatabaseService {
  constructor(prismaService: PrismaService, configService: ConfigService) {
    super(prismaService, configService);
  }

  /**
   * Validate an invitation by token and email
   * Returns the invitation if valid and not expired/used
   */
  async validateInvitation(
    invitationToken: string,
    email: string
  ): Promise<Invitation | null> {
    try {
      const data = await this.prisma.invitation.findFirst({
        where: {
          token: invitationToken,
          email,
          status: "pending"
        }
      });

      if (!data) {
        this.logger.warn("Invitation not found", {
          invitationToken,
          email,
          error: undefined
        });
        return null;
      }

      // Check if invitation has expired
      const now = new Date();
      const expiresAt = new Date(data.expiresAt);

      if (now > expiresAt) {
        this.logger.warn("Invitation has expired", {
          invitationToken,
          email,
          expiresAt
        });
        return null;
      }

      // Check if invitation has already been accepted
      if (data.acceptedAt) {
        this.logger.warn("Invitation has already been accepted", {
          invitationToken,
          email,
          acceptedAt: data.acceptedAt
        });
        return null;
      }

      this.logger.debug("Valid invitation found", {
        invitationToken,
        email,
        invitationId: data.id
      });
      return data as unknown as Invitation;
    } catch (error) {
      this.logger.error("Error validating invitation", {
        error: error instanceof Error ? error.message : String(error),
        invitationToken,
        email
      });
      return null;
    }
  }

  /**
   * Mark an invitation as accepted
   */
  async markInvitationAsAccepted(
    invitationId: string,
    acceptedBy: string
  ): Promise<boolean> {
    try {
      await this.prisma.invitation.update({
        where: { id: invitationId },
        data: {
          status: "accepted",
          acceptedAt: new Date(),
          acceptedBy: acceptedBy,
          updatedAt: new Date()
        }
      });

      this.logger.debug("Invitation marked as accepted", {
        invitationId,
        acceptedBy
      });
      return true;
    } catch (error) {
      this.logger.error("Error marking invitation as accepted", {
        error: error instanceof Error ? error.message : String(error),
        invitationId,
        acceptedBy
      });
      return false;
    }
  }
}
