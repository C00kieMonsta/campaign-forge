import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@/config/config.service";
import { RolesDatabaseService } from "@/shared/database/services/roles.database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

describe("RolesDatabaseService", () => {
  let service: RolesDatabaseService;
  let prisma: any;

  beforeEach(async () => {
    const mockPrismaClient = {
      role: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesDatabaseService,
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

    service = module.get<RolesDatabaseService>(RolesDatabaseService);
    const prismaService = module.get(PrismaService);
    prisma = prismaService.client;
  });

  describe("getRoleById", () => {
    it("should return role when found", async () => {
      const mockRole = {
        id: "role-123",
        name: "Admin",
        slug: "admin",
        isSystem: true
      };

      prisma.role.findUnique.mockResolvedValue(mockRole);

      const result = await service.getRoleById("role-123");

      expect(result).toEqual(mockRole);
      expect(prisma.role.findUnique).toHaveBeenCalledWith({
        where: { id: "role-123" }
      });
    });

    it("should return null when role not found", async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      const result = await service.getRoleById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getRolesByOrganizationId", () => {
    it("should return roles for organization", async () => {
      const mockRoles = [
        { id: "role-1", name: "Admin", organizationId: "org-123" },
        { id: "role-2", name: "Member", organizationId: "org-123" }
      ];

      prisma.role.findMany.mockResolvedValue(mockRoles);

      const result = await service.getRolesByOrganizationId("org-123");

      expect(result).toEqual(mockRoles);
      expect(prisma.role.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-123" },
        orderBy: { createdAt: "desc" }
      });
    });
  });

  describe("getSystemRoles", () => {
    it("should return system roles", async () => {
      const mockRoles = [
        { id: "role-1", name: "Admin", isSystem: true, organizationId: null }
      ];

      prisma.role.findMany.mockResolvedValue(mockRoles);

      const result = await service.getSystemRoles();

      expect(result).toEqual(mockRoles);
      expect(prisma.role.findMany).toHaveBeenCalledWith({
        where: { isSystem: true, organizationId: null },
        orderBy: { createdAt: "desc" }
      });
    });
  });

  describe("createRole", () => {
    it("should create role successfully", async () => {
      const roleData = {
        name: "Custom Role",
        slug: "custom-role",
        description: "Custom role",
        isSystem: false,
        organizationId: "org-123"
      };

      const createdRole = { id: "role-id", ...roleData };
      prisma.role.create.mockResolvedValue(createdRole);

      const result = await service.createRole(roleData);

      expect(result).toEqual(createdRole);
      expect(prisma.role.create).toHaveBeenCalled();
    });
  });

  describe("deleteRole", () => {
    it("should delete role successfully", async () => {
      prisma.role.delete.mockResolvedValue({});

      await service.deleteRole("role-123");

      expect(prisma.role.delete).toHaveBeenCalledWith({
        where: { id: "role-123" }
      });
    });
  });
});
