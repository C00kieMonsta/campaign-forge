import { Injectable } from "@nestjs/common";
import {
  Invitation,
  InvitationListResponse,
  OrganizationMember,
  OrganizationMemberListResponse,
  Role,
  RoleListResponse,
  SendInvitationRequest
} from "@packages/types";
import { JWTVerificationService } from "@/auth/jwt-verification.service";
import { ConfigService } from "@/config/config.service";
import { InvitationsDatabaseService } from "@/shared/database/services/invitations.database.service";
import { OrganizationMembersDatabaseService } from "@/shared/database/services/organization-members.database.service";
import { OrganizationsDatabaseService } from "@/shared/database/services/organizations.database.service";
import { RolesDatabaseService } from "@/shared/database/services/roles.database.service";
import { UsersDatabaseService } from "@/shared/database/services/users.database.service";
import { InvitationEmailService } from "@/shared/email/invitation-email.service";

@Injectable()
export class OrganizationService {
  constructor(
    private organizationMembersDb: OrganizationMembersDatabaseService,
    private organizationsDb: OrganizationsDatabaseService,
    private invitationsDb: InvitationsDatabaseService,
    private rolesDb: RolesDatabaseService,
    private usersDb: UsersDatabaseService,
    private invitationEmailService: InvitationEmailService,
    private configService: ConfigService,
    private jwtVerificationService: JWTVerificationService
  ) {}

  // Organization Members Management
  async getOrganizationMembers(
    organizationId: string
  ): Promise<OrganizationMember[]> {
    return this.organizationMembersDb.getOrganizationMembers(organizationId);
  }

  async getOrganizationMembersWithPagination(
    organizationId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<OrganizationMemberListResponse> {
    // Get organization members with user data
    const members = await this.getOrganizationMembers(organizationId);

    // Filter out members without user data and return complete member objects
    const validMembers = members.filter((member) => member.user);

    return {
      users: validMembers, // Return full OrganizationMember objects with user and role data
      total: validMembers.length,
      page,
      limit
    };
  }

  async updateMemberRole(
    memberId: string,
    roleId: string
  ): Promise<OrganizationMember> {
    return this.organizationMembersDb.updateOrganizationMemberRole(
      memberId,
      roleId
    );
  }

  async updateMemberStatus(
    memberId: string,
    status: "active" | "inactive" | "suspended"
  ): Promise<OrganizationMember> {
    return this.organizationMembersDb.updateOrganizationMemberStatus(
      memberId,
      status
    );
  }

  async removeMember(memberId: string): Promise<void> {
    return this.organizationMembersDb.removeOrganizationMember(memberId);
  }

  // Roles Management
  async getAvailableRoles(organizationId: string): Promise<Role[]> {
    return this.rolesDb.getAvailableRoles(organizationId);
  }

  async getAvailableRolesWithPagination(
    organizationId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<RoleListResponse> {
    // For now, return all roles without pagination
    // This can be enhanced later with actual pagination
    const roles = await this.getAvailableRoles(organizationId);

    return {
      roles,
      total: roles.length,
      page,
      limit
    };
  }

  // Invitations Management
  async sendInvitation(
    organizationId: string,
    invitedBy: string,
    data: SendInvitationRequest
  ): Promise<Invitation> {
    // Create the invitation in our database first
    const invitation = await this.invitationsDb.createInvitation({
      ...data,
      organizationId,
      invitedBy
    });

    // Get organization and role details for email
    const [organization, role, inviter] = await Promise.all([
      this.organizationsDb.getOrganizationById(organizationId),
      this.rolesDb.getRoleById(data.roleId),
      this.usersDb.getUserById(invitedBy)
    ]);

    try {
      // Send invitation email via AWS SES
      const emailResult = await this.invitationEmailService.sendInvitationEmail(
        {
          recipientEmail: data.email,
          organizationName: organization?.name || "Organization",
          roleName: role?.name || "Member",
          inviterName:
            `${inviter?.firstName || ""} ${inviter?.lastName || ""}`.trim() ||
            "Team",
          invitationToken: invitation.token,
          frontendUrl:
            this.configService.getString("FRONTEND_URL") ||
            "http://localhost:8000"
        }
      );

      if (!emailResult.success) {
        console.error("Failed to send invitation email:", emailResult.error);
      } else {
        console.log("Invitation email sent successfully to:", data.email);
      }
    } catch (error) {
      console.error("Error sending invitation email:", error);
    }

    return invitation;
  }

  async getOrganizationInvitations(
    organizationId: string
  ): Promise<Invitation[]> {
    const invitations =
      await this.invitationsDb.getInvitationsByOrganization(organizationId);
    return invitations as unknown as Invitation[];
  }

  async getOrganizationInvitationsWithPagination(
    organizationId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<InvitationListResponse> {
    // For now, return all invitations without pagination
    const invitations = await this.getOrganizationInvitations(organizationId);

    return {
      // @ts-ignore - Type mapping issue with database objects
      invitations,
      total: invitations.length,
      page,
      limit
    };
  }

  async resendInvitation(invitationId: string): Promise<Invitation> {
    const invitation = await this.invitationsDb.resendInvitation(invitationId);

    // Get organization and role details for email
    const [organization, role, inviter] = await Promise.all([
      this.organizationsDb.getOrganizationById(invitation.organizationId),
      this.rolesDb.getRoleById(invitation.roleId),
      this.usersDb.getUserById(invitation.invitedBy)
    ]);

    try {
      // Send invitation email again via AWS SES
      const emailResult = await this.invitationEmailService.sendInvitationEmail(
        {
          recipientEmail: invitation.email,
          organizationName: organization?.name || "Organization",
          roleName: role?.name || "Member",
          inviterName:
            `${inviter?.firstName || ""} ${inviter?.lastName || ""}`.trim() ||
            "Team",
          invitationToken: invitation.token,
          frontendUrl:
            this.configService.getString("FRONTEND_URL") ||
            "http://localhost:8000"
        }
      );

      if (!emailResult.success) {
        console.error("Failed to resend invitation email:", emailResult.error);
      } else {
        console.log(
          "Invitation email resent successfully to:",
          invitation.email
        );
      }
    } catch (error) {
      console.error("Error resending invitation email:", error);
    }

    return invitation;
  }

  async cancelInvitation(invitationId: string): Promise<void> {
    return this.invitationsDb.deleteInvitation(invitationId);
  }

  async acceptInvitation(
    token: string,
    userId: string
  ): Promise<OrganizationMember> {
    // Get the invitation
    const invitation = await this.invitationsDb.getInvitationByToken(token);
    if (!invitation) {
      throw new Error("Invitation not found or expired");
    }

    if (invitation.status !== "pending") {
      throw new Error("Invitation is no longer valid");
    }

    if (new Date() > new Date(invitation.expiresAt)) {
      throw new Error("Invitation has expired");
    }

    // Add user to organization
    const member = await this.organizationMembersDb.addOrganizationMember({
      organizationId: invitation.organizationId,
      userId,
      roleId: invitation.roleId
    });

    // Update invitation status
    await this.invitationsDb.updateInvitationStatus(
      invitation.id,
      "accepted",
      userId
    );

    // Clear JWT cache for this user since their organization membership has changed
    this.jwtVerificationService.clearUserCache(userId);

    return member;
  }
}
