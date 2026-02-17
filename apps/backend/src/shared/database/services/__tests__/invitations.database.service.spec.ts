import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@/config/config.service";
import { InvitationsDatabaseService } from "@/shared/database/services/invitations.database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

describe("InvitationsDatabaseService", () => {
  let service: InvitationsDatabaseService;
  let prisma: any;

  beforeEach(async () => {
    const mockPrismaClient = {
      invitation: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsDatabaseService,
        {
          provide: PrismaService,
          useValue: {
            client: mockPrismaClient
          }
        },
        {
          provide: ConfigService,
          useValue: {
            getSupabaseConfig: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get<InvitationsDatabaseService>(
      InvitationsDatabaseService
    );
    const prismaService = module.get(PrismaService);
    prisma = prismaService.client;
  });

  describe("createInvitation", () => {
    it("should create invitation successfully", async () => {
      const invitationData = {
        organizationId: "org-123",
        email: "invited@example.com",
        roleId: "role-123",
        invitedBy: "user-123"
      };

      const createdInvitation = {
        id: "invite-id",
        ...invitationData,
        status: "pending"
      };

      prisma.invitation.create.mockResolvedValue(createdInvitation);

      const result = await service.createInvitation(invitationData);

      expect(result).toEqual(createdInvitation);
      expect(prisma.invitation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: invitationData.organizationId,
          email: invitationData.email,
          status: "pending"
        })
      });
    });
  });

  describe("getInvitationsByOrganization", () => {
    it("should return invitations for organization", async () => {
      const mockInvitations = [
        { id: "invite-1", email: "user1@example.com" },
        { id: "invite-2", email: "user2@example.com" }
      ];

      prisma.invitation.findMany.mockResolvedValue(mockInvitations);

      const result = await service.getInvitationsByOrganization("org-123");

      expect(result).toEqual(mockInvitations);
      expect(prisma.invitation.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-123" },
        orderBy: { createdAt: "desc" }
      });
    });
  });

  describe("getInvitationByToken", () => {
    it("should return invitation when found", async () => {
      const mockInvitation = {
        id: "invite-id",
        token: "token-123",
        email: "test@example.com"
      };

      prisma.invitation.findUnique.mockResolvedValue(mockInvitation);

      const result = await service.getInvitationByToken("token-123");

      expect(result).toEqual(mockInvitation);
    });

    it("should return null when invitation not found", async () => {
      prisma.invitation.findUnique.mockResolvedValue(null);

      const result = await service.getInvitationByToken("invalid-token");

      expect(result).toBeNull();
    });
  });

  describe("updateInvitationStatus", () => {
    it("should update invitation status", async () => {
      prisma.invitation.update.mockResolvedValue({});

      await service.updateInvitationStatus("invite-id", "accepted", "user-123");

      expect(prisma.invitation.update).toHaveBeenCalledWith({
        where: { id: "invite-id" },
        data: expect.objectContaining({
          status: "accepted",
          acceptedBy: "user-123"
        })
      });
    });
  });
});
