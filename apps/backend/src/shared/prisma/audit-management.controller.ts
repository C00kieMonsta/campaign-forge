import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Request as NestRequest,
  Param,
  Post,
  Query
} from "@nestjs/common";
import {
  AuditLog,
  AuthenticatedUser,
  ROLE_SLUGS,
  TABLE_NAMES
} from "@packages/types";
import { Prisma, PrismaClient } from "@prisma/client";
import { Request } from "express";
import { Audit } from "@/logger/audit.decorator";
import { AuditManagementService } from "./audit-management.service";
import { getAuditLogsForRecord } from "./audit-utils";
import { PrismaService } from "./prisma.service";

/**
 * Controller for audit log management and querying
 * These endpoints are for admin use and should be properly secured
 */
@Controller(TABLE_NAMES.AUDIT_LOG)
export class AuditManagementController {
  constructor(
    private auditManagementService: AuditManagementService,
    private prismaService: PrismaService
  ) {}

  /**
   * Get audit logs for a specific record
   */
  @Get("record/:table/:id")
  @Audit({ action: "view_audit_logs", resource: "audit" })
  async getRecordAuditLogs(
    @Param("table") table: string,
    @Param("id") id: string,
    @NestRequest() req: Request,
    @Query("limit") limit?: string
  ) {
    const user = req.user as AuthenticatedUser;

    // Basic security: only allow users to see audit logs for their organization's data
    const auditLogs = await getAuditLogsForRecord(
      this.prismaService.client,
      table,
      id,
      parseInt(limit || "50")
    );

    // Filter logs to only show those from the user's organization
    const filteredLogs = auditLogs.filter(
      (log: AuditLog) =>
        log.actorOrgId === user.organizationId || !log.actorOrgId
    );

    return {
      table,
      recordId: id,
      logs: filteredLogs,
      total: filteredLogs.length
    };
  }

  /**
   * Get audit logs for the current user's organization with enhanced filtering
   * This endpoint requires Admin role access
   */
  @Get("organization")
  @Audit({ action: "view_organization_audit_logs", resource: "audit" })
  async getOrganizationAuditLogs(
    @NestRequest() req: Request,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @Query("actorEmail") actorEmail?: string,
    @Query("targetTable") targetTable?: string,
    @Query("action") action?: string,
    @Query("actorName") actorName?: string
  ) {
    const user = req.user as AuthenticatedUser;

    // Role-based access control - only Admin users can view audit logs
    const hasAdminAccess = await this.checkAdminAccess(user);
    if (!hasAdminAccess) {
      throw new HttpException(
        "Admin access required to view audit logs",
        HttpStatus.FORBIDDEN
      );
    }

    if (!user.organizationId) {
      throw new HttpException(
        "User not associated with organization",
        HttpStatus.FORBIDDEN
      );
    }

    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    const pageLimit = parseInt(limit || "50");
    const pageOffset = parseInt(offset || "0");

    // Enhanced filtering
    const filters = {
      actorEmail: actorEmail?.trim(),
      targetTable: targetTable?.trim(),
      action: action?.trim(),
      actorName: actorName?.trim()
    };

    const result = await this.getEnhancedAuditLogsForOrganization(
      user.organizationId,
      start,
      end,
      pageLimit,
      pageOffset,
      filters
    );

    return {
      organizationId: user.organizationId,
      startDate: start?.toISOString(),
      endDate: end?.toISOString(),
      filters,
      logs: result.logs,
      total: result.total,
      page: Math.floor(pageOffset / pageLimit) + 1,
      limit: pageLimit,
      hasMore: result.total > pageOffset + pageLimit
    };
  }

  /**
   * Enhanced audit logs query with filtering and pagination
   */
  private async getEnhancedAuditLogsForOrganization(
    organizationId: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 50,
    offset: number = 0,
    filters: {
      actorEmail?: string;
      targetTable?: string;
      action?: string;
      actorName?: string;
    } = {}
  ) {
    const where: Prisma.AuditLogWhereInput = {
      actorOrgId: organizationId
    };

    // Date filtering
    if (startDate || endDate) {
      where.occurredAt = {};
      if (startDate) {
        where.occurredAt.gte = startDate;
      }
      if (endDate) {
        // Adjust endDate to include the entire day (23:59:59.999)
        const adjustedEndDate = new Date(endDate);
        adjustedEndDate.setHours(23, 59, 59, 999);
        where.occurredAt.lte = adjustedEndDate;
      }
    }

    // Additional filters
    if (filters.actorEmail) {
      where.actorEmail = {
        contains: filters.actorEmail,
        mode: "insensitive"
      };
    }

    if (filters.targetTable) {
      where.targetTable = {
        contains: filters.targetTable,
        mode: "insensitive"
      };
    }

    if (filters.action) {
      where.action = {
        contains: filters.action,
        mode: "insensitive"
      };
    }

    const prisma = this.prismaService.client as PrismaClient;

    // Get total count for pagination
    const total = await prisma.auditLog.count({ where });

    // Get paginated results with user information
    const rawLogs = await prisma.auditLog.findMany({
      where,
      orderBy: {
        occurredAt: "desc"
      },
      skip: offset,
      take: limit
    });

    // Convert raw logs to AuditLog type and enhance with formatted data
    type EnhancedAuditLog = AuditLog & {
      actorDisplayName?: string;
      formattedDate?: string;
    };

    const enhancedLogs: EnhancedAuditLog[] = rawLogs.map((log) => {
      // Try to extract actor name from actorEmail or other sources
      let actorName = "";
      if (log.actorEmail) {
        // Extract name from email if available
        const emailParts = log.actorEmail.split("@")[0];
        actorName = emailParts
          .replace(/[._]/g, " ")
          .toLowerCase()
          .split(" ")
          .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
      }

      return {
        id: log.id,
        occurredAt: log.occurredAt.toISOString(),
        actorUserId: log.actorUserId,
        actorOrgId: log.actorOrgId,
        actorEmail: log.actorEmail,
        targetTable: log.targetTable,
        targetId: log.targetId,
        action: log.action,
        before: log.before,
        after: log.after,
        correlationId: log.correlationId,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        actorDisplayName: actorName || log.actorEmail || "System",
        formattedDate: log.occurredAt.toISOString()
      };
    });

    // Apply actor name filtering if needed (post-processing since it's derived)
    let filteredLogs = enhancedLogs;
    if (filters.actorName) {
      const searchTerm = filters.actorName.toLowerCase();
      filteredLogs = enhancedLogs.filter(
        (log) =>
          (log.actorDisplayName &&
            log.actorDisplayName.toLowerCase().includes(searchTerm)) ||
          (log.actorEmail && log.actorEmail.toLowerCase().includes(searchTerm))
      );
    }

    return {
      logs: filteredLogs,
      total: filters.actorName ? filteredLogs.length : total
    };
  }

  /**
   * Get audit system health metrics (admin only)
   */
  @Get("health")
  @Audit({ action: "view_audit_health", resource: "audit" })
  async getAuditHealth(@NestRequest() req: Request) {
    const user = req.user as AuthenticatedUser;

    // Role-based access control using organization membership
    const hasAdminAccess = await this.checkAdminAccess(user);
    if (!hasAdminAccess) {
      throw new HttpException("Admin access required", HttpStatus.FORBIDDEN);
    }

    return this.auditManagementService.getAuditHealth();
  }

  /**
   * Manually trigger audit log cleanup (admin only)
   */
  @Post("cleanup")
  @Audit({ action: "manual_audit_cleanup", resource: "audit" })
  async manualCleanup(
    @NestRequest() req: Request,
    @Query("daysToKeep") daysToKeep?: string
  ) {
    const user = req.user as AuthenticatedUser;

    // Role-based access control using organization membership
    const hasAdminAccess = await this.checkAdminAccess(user);
    if (!hasAdminAccess) {
      throw new HttpException("Admin access required", HttpStatus.FORBIDDEN);
    }

    const days = parseInt(daysToKeep || "365");
    if (days < 30) {
      throw new HttpException(
        "Cannot delete audit logs newer than 30 days",
        HttpStatus.BAD_REQUEST
      );
    }

    const deletedCount = await this.auditManagementService.manualCleanup(days);

    return {
      message: "Audit log cleanup completed",
      deletedCount,
      daysToKeep: days
    };
  }

  /**
   * Check if user has admin access by looking at their organization membership role
   */
  private async checkAdminAccess(user: AuthenticatedUser): Promise<boolean> {
    if (!user.organizationId) {
      return false;
    }

    const prisma = this.prismaService.client as PrismaClient;

    try {
      const membership = await prisma.organizationMember.findFirst({
        where: {
          userId: user.id,
          organizationId: user.organizationId,
          status: "active"
        },
        include: {
          role: {
            select: {
              slug: true,
              isSystem: true
            }
          }
        }
      });

      if (!membership || !membership.role) {
        return false;
      }

      // Check if user has admin role (either system admin or organization admin)
      return membership.role.slug === ROLE_SLUGS.ADMIN;
    } catch (error) {
      console.error("Failed to check admin access:", error);
      return false;
    }
  }
}
