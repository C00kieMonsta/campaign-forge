import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request
} from "@nestjs/common";
import {
  CreateOrganizationRequest,
  CreateOrganizationRequestSchema,
  Invitation,
  InvitationListResponse,
  OrganizationMember,
  OrganizationMemberListResponse,
  PaginationRequest,
  PaginationRequestSchema,
  RoleListResponse,
  SendInvitationRequest,
  SendInvitationRequestSchema,
  TABLE_NAMES,
  UpdateOrganizationRequest,
  UpdateOrganizationRequestSchema,
  type Organization
} from "@packages/types";
import { ConfigService } from "@/config/config.service";
import { Audit } from "@/logger/audit.decorator";
import { OrganizationService } from "@/organization/organization.service";
import { BaseDatabaseService } from "@/shared/database/base-database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";
import { AuthenticatedRequest } from "@/shared/types/request.types";

@Controller(TABLE_NAMES.ORGANIZATIONS)
export class OrganizationController extends BaseDatabaseService {
  constructor(
    prismaService: PrismaService,
    configService: ConfigService,
    private organizationService: OrganizationService
  ) {
    super(prismaService, configService);
  }

  @Post()
  @Audit({
    action: "create_organization",
    resource: "organization"
  })
  async create(@Body() body: CreateOrganizationRequest): Promise<Organization> {
    // Validate request payload
    const createData = CreateOrganizationRequestSchema.parse(body);

    // Create organization via Prisma
    const created = await this.prisma.organization.create({
      data: {
        name: createData.name,
        slug: createData.slug,
        description: createData.description || null,
        meta: {}
      }
    });

    return created as unknown as Organization;
  }

  @Get()
  @Audit({
    action: "list_organizations",
    resource: "organization"
  })
  async list(@Query() query: PaginationRequest): Promise<{
    organizations: Organization[];
    total: number;
    page: number;
    limit: number;
  }> {
    // Validate pagination parameters
    const pagination = PaginationRequestSchema.parse(query);

    const [total, items] = await this.prisma.$transaction([
      this.prisma.organization.count(),
      this.prisma.organization.findMany({
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
        orderBy: { createdAt: "desc" }
      })
    ]);

    return {
      organizations: items as unknown as Organization[],
      total,
      page: pagination.page,
      limit: pagination.limit
    };
  }

  @Get(":id")
  @Audit({
    action: "get_organization",
    resource: "organization"
  })
  async get(@Param("id") id: string): Promise<Organization> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) {
      throw new Error("Organization not found");
    }
    return org as unknown as Organization;
  }

  @Put(":id")
  @Audit({
    action: "update_organization",
    resource: "organization"
  })
  async update(
    @Param("id") id: string,
    @Body() body: UpdateOrganizationRequest
  ): Promise<Organization> {
    // Validate request payload
    const updateData = UpdateOrganizationRequestSchema.parse(body);
    const updated = await this.prisma.organization.update({
      where: { id },
      data: {
        name: updateData.name ?? undefined,
        slug: updateData.slug ?? undefined,
        description: updateData.description ?? undefined
      }
    });

    return updated as unknown as Organization;
  }

  @Delete(":id")
  @Audit({
    action: "delete_organization",
    resource: "organization"
  })
  async delete(@Param("id") id: string): Promise<{ message: string }> {
    await this.prisma.organization.delete({ where: { id } });
    return { message: "Organization deleted successfully" };
  }

  // Organization Members Management
  @Get(":id/members")
  @Audit({ action: "list", resource: "organization_members" })
  async getMembers(
    @Param("id") organizationId: string,
    @Query("page") page: string = "1",
    @Query("limit") limit: string = "10"
  ): Promise<OrganizationMemberListResponse> {
    return this.organizationService.getOrganizationMembersWithPagination(
      organizationId,
      parseInt(page),
      parseInt(limit)
    );
  }

  @Put("members/:memberId/role")
  @Audit({ action: "update_role", resource: "organization_member" })
  async updateMemberRole(
    @Param("memberId") memberId: string,
    @Body() body: { roleId: string }
  ): Promise<OrganizationMember> {
    return this.organizationService.updateMemberRole(memberId, body.roleId);
  }

  @Put("members/:memberId/status")
  @Audit({ action: "update_status", resource: "organization_member" })
  async updateMemberStatus(
    @Param("memberId") memberId: string,
    @Body() body: { status: "active" | "inactive" | "suspended" }
  ): Promise<OrganizationMember> {
    return this.organizationService.updateMemberStatus(memberId, body.status);
  }

  @Delete("members/:memberId")
  @Audit({ action: "remove", resource: "organization_member" })
  async removeMember(@Param("memberId") memberId: string): Promise<void> {
    return this.organizationService.removeMember(memberId);
  }

  // Roles Management
  @Get(":id/roles")
  @Audit({ action: "list", resource: "roles" })
  async getRoles(
    @Param("id") organizationId: string,
    @Query("page") page: string = "1",
    @Query("limit") limit: string = "10"
  ): Promise<RoleListResponse> {
    return this.organizationService.getAvailableRolesWithPagination(
      organizationId,
      parseInt(page),
      parseInt(limit)
    );
  }

  // Invitations Management
  @Post(":id/invite")
  @Audit({ action: "send", resource: "invitation" })
  async sendInvitation(
    @Param("id") organizationId: string,
    @Body() body: SendInvitationRequest,
    @Request() req: AuthenticatedRequest
  ): Promise<Invitation> {
    const data = SendInvitationRequestSchema.parse(body);
    const user = req.user;
    if (!user) {
      throw new Error("User not authenticated");
    }
    const invitedBy = user.id;

    return this.organizationService.sendInvitation(
      organizationId,
      invitedBy,
      data
    );
  }

  @Get(":id/invitations")
  @Audit({ action: "list", resource: "invitations" })
  async getInvitations(
    @Param("id") organizationId: string,
    @Query("page") page: string = "1",
    @Query("limit") limit: string = "10"
  ): Promise<InvitationListResponse> {
    return this.organizationService.getOrganizationInvitationsWithPagination(
      organizationId,
      parseInt(page),
      parseInt(limit)
    );
  }

  @Post("invitations/:invitationId/resend")
  @Audit({ action: "resend", resource: "invitation" })
  async resendInvitation(
    @Param("invitationId") invitationId: string
  ): Promise<Invitation> {
    return this.organizationService.resendInvitation(invitationId);
  }

  @Delete("invitations/:invitationId")
  @Audit({ action: "cancel", resource: "invitation" })
  async cancelInvitation(
    @Param("invitationId") invitationId: string
  ): Promise<void> {
    return this.organizationService.cancelInvitation(invitationId);
  }
}
