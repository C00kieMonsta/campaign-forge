import { Test, TestingModule } from "@nestjs/testing";
import { JWTVerificationService } from "@/auth/jwt-verification.service";
import { ConfigService } from "@/config/config.service";
import { OrganizationService } from "@/organization/organization.service";
import { InvitationsDatabaseService } from "@/shared/database/services/invitations.database.service";
import { OrganizationMembersDatabaseService } from "@/shared/database/services/organization-members.database.service";
import { OrganizationsDatabaseService } from "@/shared/database/services/organizations.database.service";
import { RolesDatabaseService } from "@/shared/database/services/roles.database.service";
import { UsersDatabaseService } from "@/shared/database/services/users.database.service";
import { InvitationEmailService } from "@/shared/email/invitation-email.service";

describe("OrganizationService", () => {
  let service: OrganizationService;
  let organizationMembersDb: jest.Mocked<OrganizationMembersDatabaseService>;
  let organizationsDb: jest.Mocked<OrganizationsDatabaseService>;
  let invitationsDb: jest.Mocked<InvitationsDatabaseService>;
  let rolesDb: jest.Mocked<RolesDatabaseService>;
  let usersDb: jest.Mocked<UsersDatabaseService>;
  let invitationEmailService: jest.Mocked<InvitationEmailService>;
  let jwtVerificationService: jest.Mocked<JWTVerificationService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationService,
        {
          provide: OrganizationMembersDatabaseService,
          useValue: {
            getOrganizationMembers: jest.fn(),
            updateOrganizationMemberRole: jest.fn(),
            updateOrganizationMemberStatus: jest.fn(),
            removeOrganizationMember: jest.fn(),
            addOrganizationMember: jest.fn()
          }
        },
        {
          provide: OrganizationsDatabaseService,
          useValue: {
            getOrganizationById: jest.fn()
          }
        },
        {
          provide: InvitationsDatabaseService,
          useValue: {
            createInvitation: jest.fn(),
            getInvitationsByOrganization: jest.fn(),
            getInvitationByToken: jest.fn(),
            resendInvitation: jest.fn(),
            deleteInvitation: jest.fn(),
            updateInvitationStatus: jest.fn()
          }
        },
        {
          provide: RolesDatabaseService,
          useValue: {
            getAvailableRoles: jest.fn(),
            getRoleById: jest.fn()
          }
        },
        {
          provide: UsersDatabaseService,
          useValue: {
            getUserById: jest.fn()
          }
        },
        {
          provide: InvitationEmailService,
          useValue: {
            sendInvitationEmail: jest.fn()
          }
        },
        {
          provide: ConfigService,
          useValue: {
            getString: jest.fn().mockReturnValue("http://localhost:8000")
          }
        },
        {
          provide: JWTVerificationService,
          useValue: {
            clearUserCache: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get<OrganizationService>(OrganizationService);
    organizationMembersDb = module.get(OrganizationMembersDatabaseService);
    organizationsDb = module.get(OrganizationsDatabaseService);
    invitationsDb = module.get(InvitationsDatabaseService);
    rolesDb = module.get(RolesDatabaseService);
    usersDb = module.get(UsersDatabaseService);
    invitationEmailService = module.get(InvitationEmailService);
    jwtVerificationService = module.get(JWTVerificationService);
  });

  describe("getOrganizationMembers", () => {
    it("should return organization members", async () => {
      const mockMembers = [
        { id: "member-1", userId: "user-1", organizationId: "org-123" }
      ] as any;

      organizationMembersDb.getOrganizationMembers.mockResolvedValue(
        mockMembers
      );

      const result = await service.getOrganizationMembers("org-123");

      expect(result).toEqual(mockMembers);
      expect(organizationMembersDb.getOrganizationMembers).toHaveBeenCalledWith(
        "org-123"
      );
    });
  });

  describe("updateMemberRole", () => {
    it("should update member role", async () => {
      const mockMember = {
        id: "member-1",
        roleId: "role-123"
      } as any;

      organizationMembersDb.updateOrganizationMemberRole.mockResolvedValue(
        mockMember
      );

      const result = await service.updateMemberRole("member-1", "role-123");

      expect(result).toEqual(mockMember);
    });
  });

  describe("getAvailableRoles", () => {
    it("should return available roles", async () => {
      const mockRoles = [
        { id: "role-1", name: "Admin" },
        { id: "role-2", name: "Member" }
      ] as any;

      rolesDb.getAvailableRoles.mockResolvedValue(mockRoles);

      const result = await service.getAvailableRoles("org-123");

      expect(result).toEqual(mockRoles);
      expect(rolesDb.getAvailableRoles).toHaveBeenCalledWith("org-123");
    });
  });

  describe("sendInvitation", () => {
    it("should send invitation successfully", async () => {
      const invitationData = {
        email: "invited@example.com",
        roleId: "role-123"
      };

      const mockInvitation = {
        id: "invite-id",
        token: "token-123",
        ...invitationData,
        organizationId: "org-123"
      } as any;

      invitationsDb.createInvitation.mockResolvedValue(mockInvitation);
      organizationsDb.getOrganizationById.mockResolvedValue({
        id: "org-123",
        name: "Test Org"
      } as any);
      rolesDb.getRoleById.mockResolvedValue({
        id: "role-123",
        name: "Admin"
      } as any);
      usersDb.getUserById.mockResolvedValue({
        id: "user-123",
        firstName: "John",
        lastName: "Doe"
      } as any);
      invitationEmailService.sendInvitationEmail.mockResolvedValue({
        success: true,
        messageId: "msg-123"
      });

      const result = await service.sendInvitation(
        "org-123",
        "user-123",
        invitationData
      );

      expect(result).toEqual(mockInvitation);
      expect(invitationsDb.createInvitation).toHaveBeenCalled();
      expect(invitationEmailService.sendInvitationEmail).toHaveBeenCalled();
    });
  });

  describe("acceptInvitation", () => {
    it("should accept valid invitation", async () => {
      const mockInvitation = {
        id: "invite-id",
        token: "token-123",
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000),
        organizationId: "org-123",
        roleId: "role-123"
      } as any;

      const mockMember = {
        id: "member-id",
        userId: "user-123",
        organizationId: "org-123"
      } as any;

      invitationsDb.getInvitationByToken.mockResolvedValue(mockInvitation);
      organizationMembersDb.addOrganizationMember.mockResolvedValue(mockMember);
      invitationsDb.updateInvitationStatus.mockResolvedValue({
        ...mockInvitation,
        status: "accepted",
        acceptedBy: "user-123",
        acceptedAt: new Date()
      });

      const result = await service.acceptInvitation("token-123", "user-123");

      expect(result).toEqual(mockMember);
      expect(jwtVerificationService.clearUserCache).toHaveBeenCalledWith(
        "user-123"
      );
    });

    it("should throw error for invalid invitation", async () => {
      invitationsDb.getInvitationByToken.mockResolvedValue(null);

      await expect(
        service.acceptInvitation("invalid-token", "user-123")
      ).rejects.toThrow("Invitation not found or expired");
    });

    it("should throw error for expired invitation", async () => {
      const mockInvitation = {
        id: "invite-id",
        status: "pending",
        expiresAt: new Date(Date.now() - 86400000)
      } as any;

      invitationsDb.getInvitationByToken.mockResolvedValue(mockInvitation);

      await expect(
        service.acceptInvitation("token-123", "user-123")
      ).rejects.toThrow("Invitation has expired");
    });
  });

  describe("cancelInvitation", () => {
    it("should cancel invitation", async () => {
      invitationsDb.deleteInvitation.mockResolvedValue();

      await service.cancelInvitation("invite-id");

      expect(invitationsDb.deleteInvitation).toHaveBeenCalledWith("invite-id");
    });
  });
});
