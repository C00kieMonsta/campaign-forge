import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@/config/config.service";
import { OrganizationMembersDatabaseService } from "@/shared/database/services/organization-members.database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

describe("OrganizationMembersDatabaseService", () => {
  let service: OrganizationMembersDatabaseService;
  let prisma: any;

  beforeEach(async () => {
    const mockPrismaClient = {
      organizationMember: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationMembersDatabaseService,
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

    service = module.get<OrganizationMembersDatabaseService>(
      OrganizationMembersDatabaseService
    );
    const prismaService = module.get(PrismaService);
    prisma = prismaService.client;
  });

  describe("getOrganizationMembers", () => {
    it("should return organization members", async () => {
      const mockMembers = [
        {
          id: "member-1",
          userId: "user-1",
          organizationId: "org-123",
          user: { id: "user-1", email: "user1@example.com" },
          role: { id: "role-1", name: "Admin" }
        }
      ];

      prisma.organizationMember.findMany.mockResolvedValue(mockMembers);

      const result = await service.getOrganizationMembers("org-123");

      expect(result).toEqual(mockMembers);
      expect(prisma.organizationMember.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-123" },
        include: expect.any(Object),
        orderBy: { joinedAt: "desc" }
      });
    });
  });

  describe("getOrganizationMemberById", () => {
    it("should return member when found", async () => {
      const mockMember = {
        id: "member-1",
        userId: "user-1",
        organizationId: "org-123",
        user: { id: "user-1", email: "user1@example.com" },
        role: { id: "role-1", name: "Admin" }
      };

      prisma.organizationMember.findUnique.mockResolvedValue(mockMember);

      const result = await service.getOrganizationMemberById("member-1");

      expect(result).toEqual(mockMember);
    });

    it("should return null when member not found", async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(null);

      const result = await service.getOrganizationMemberById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("addOrganizationMember", () => {
    it("should add member successfully", async () => {
      const mockMember = {
        id: "member-id",
        organizationId: "org-123",
        userId: "user-123",
        roleId: "role-123",
        status: "active"
      };

      prisma.organizationMember.create.mockResolvedValue(mockMember);

      const result = await service.addOrganizationMember({
        organizationId: "org-123",
        userId: "user-123",
        roleId: "role-123"
      });

      expect(result).toEqual(mockMember);
      expect(prisma.organizationMember.create).toHaveBeenCalledWith({
        data: {
          organizationId: "org-123",
          userId: "user-123",
          roleId: "role-123",
          status: "active"
        },
        include: expect.any(Object)
      });
    });
  });

  describe("updateOrganizationMemberRole", () => {
    it("should update member role", async () => {
      const mockMember = {
        id: "member-1",
        roleId: "new-role-id"
      };

      prisma.organizationMember.update.mockResolvedValue(mockMember);

      const result = await service.updateOrganizationMemberRole(
        "member-1",
        "new-role-id"
      );

      expect(result).toEqual(mockMember);
    });
  });

  describe("removeOrganizationMember", () => {
    it("should remove member successfully", async () => {
      prisma.organizationMember.delete.mockResolvedValue({});

      await service.removeOrganizationMember("member-1");

      expect(prisma.organizationMember.delete).toHaveBeenCalledWith({
        where: { id: "member-1" }
      });
    });
  });
});
