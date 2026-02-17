import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@/config/config.service";
import { OrganizationsDatabaseService } from "@/shared/database/services/organizations.database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

describe("OrganizationsDatabaseService", () => {
  let service: OrganizationsDatabaseService;
  let prisma: any;

  beforeEach(async () => {
    const mockPrismaClient = {
      organization: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsDatabaseService,
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

    service = module.get<OrganizationsDatabaseService>(
      OrganizationsDatabaseService
    );
    const prismaService = module.get(PrismaService);
    prisma = prismaService.client;
  });

  describe("getOrganizationById", () => {
    it("should return organization when found", async () => {
      const mockOrg = {
        id: "org-123",
        name: "Test Org",
        slug: "test-org"
      };

      prisma.organization.findUnique.mockResolvedValue(mockOrg);

      const result = await service.getOrganizationById("org-123");

      expect(result).toEqual(mockOrg);
      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: "org-123" }
      });
    });

    it("should return null when organization not found", async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      const result = await service.getOrganizationById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getOrganizationBySlug", () => {
    it("should return organization when found by slug", async () => {
      const mockOrg = {
        id: "org-123",
        name: "Test Org",
        slug: "test-org"
      };

      prisma.organization.findUnique.mockResolvedValue(mockOrg);

      const result = await service.getOrganizationBySlug("test-org");

      expect(result).toEqual(mockOrg);
      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { slug: "test-org" }
      });
    });
  });

  describe("createOrganization", () => {
    it("should create organization successfully", async () => {
      const orgData = {
        name: "New Org",
        slug: "new-org",
        description: "Description",
        meta: {}
      };

      const createdOrg = { id: "org-id", ...orgData };
      prisma.organization.create.mockResolvedValue(createdOrg);

      const result = await service.createOrganization(orgData);

      expect(result).toEqual(createdOrg);
      expect(prisma.organization.create).toHaveBeenCalled();
    });
  });

  describe("getAllOrganizations", () => {
    it("should return all organizations", async () => {
      const mockOrgs = [
        { id: "org-1", name: "Org 1" },
        { id: "org-2", name: "Org 2" }
      ];

      prisma.organization.findMany.mockResolvedValue(mockOrgs);

      const result = await service.getAllOrganizations();

      expect(result).toEqual(mockOrgs);
      expect(prisma.organization.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: "desc" }
      });
    });
  });
});
