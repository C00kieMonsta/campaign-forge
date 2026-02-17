import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@/config/config.service";
import { UsersDatabaseService } from "@/shared/database/services/users.database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

describe("UsersDatabaseService", () => {
  let service: UsersDatabaseService;
  let prisma: any;

  beforeEach(async () => {
    const mockPrismaClient = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      },
      organizationMember: {
        findMany: jest.fn()
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersDatabaseService,
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

    service = module.get<UsersDatabaseService>(UsersDatabaseService);
    const prismaService = module.get(PrismaService);
    prisma = prismaService.client;
  });

  describe("getUserById", () => {
    it("should return user when found", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        firstName: "Test",
        lastName: "User"
      };

      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getUserById("user-123");

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-123" }
      });
    });

    it("should return null when user not found", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.getUserById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getUsersByOrgId", () => {
    it("should return users for organization", async () => {
      const mockMemberships = [
        {
          user: { id: "user-1", email: "user1@example.com" }
        },
        {
          user: { id: "user-2", email: "user2@example.com" }
        }
      ];

      prisma.organizationMember.findMany.mockResolvedValue(mockMemberships);

      const result = await service.getUsersByOrgId("org-123");

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(mockMemberships[0].user);
    });

    it("should return empty array when no users found", async () => {
      prisma.organizationMember.findMany.mockResolvedValue([]);

      const result = await service.getUsersByOrgId("org-123");

      expect(result).toEqual([]);
    });
  });

  describe("createUser", () => {
    it("should create user successfully", async () => {
      const userData = {
        email: "new@example.com",
        firstName: "New",
        lastName: "User",
        timezone: "UTC",
        meta: {},
        avatarUrl: null,
        phone: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const createdUser = { id: "new-user-id", ...userData };
      prisma.user.create.mockResolvedValue(createdUser);

      const result = await service.createUser(userData);

      expect(result).toEqual(createdUser);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName
        })
      });
    });
  });

  describe("updateUser", () => {
    it("should update user successfully", async () => {
      const updates = { firstName: "Updated" };
      const updatedUser = {
        id: "user-123",
        email: "test@example.com",
        firstName: "Updated",
        lastName: "User"
      };

      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateUser("user-123", updates);

      expect(result).toEqual(updatedUser);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-123" },
        data: expect.objectContaining({ firstName: "Updated" })
      });
    });
  });

  describe("deleteUser", () => {
    it("should delete user successfully", async () => {
      prisma.user.delete.mockResolvedValue({});

      await service.deleteUser("user-123");

      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: "user-123" }
      });
    });
  });
});
