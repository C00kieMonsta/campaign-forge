import { Prisma, PrismaClient } from "@prisma/client";

// Strongly typed access to auditLog delegate
type PrismaClientWithAudit = PrismaClient & {
  auditLog: Prisma.AuditLogDelegate;
};

/**
 * Utility functions for audit logging
 */

/**
 * Query audit logs for a specific table and record
 */
export async function getAuditLogsForRecord(
  prisma: PrismaClient,
  targetTable: string,
  targetId: string,
  limit: number = 50
): Promise<any[]> {
  return (prisma as any).auditLog.findMany({
    where: {
      targetTable,
      targetId
    },
    orderBy: {
      occurredAt: "desc"
    },
    take: limit,
    include: {
      actorUser: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true
        }
      },
      organization: {
        select: {
          id: true,
          name: true,
          slug: true
        }
      }
    }
  });
}

/**
 * Query audit logs for an organization within a time range
 */
export async function getAuditLogsForOrganization(
  prisma: PrismaClient,
  organizationId: string,
  startDate?: Date,
  endDate?: Date,
  limit: number = 100
): Promise<any[]> {
  const where: {
    actorOrgId: string;
    occurredAt?: {
      gte?: Date;
      lte?: Date;
    };
  } = {
    actorOrgId: organizationId
  };

  if (startDate || endDate) {
    where.occurredAt = {};
    if (startDate) where.occurredAt.gte = startDate;
    if (endDate) where.occurredAt.lte = endDate;
  }

  return (prisma as any).auditLog.findMany({
    where,
    orderBy: {
      occurredAt: "desc"
    },
    take: limit,
    include: {
      actorUser: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true
        }
      }
    }
  });
}

/**
 * Get audit statistics for an organization
 */
export async function getAuditStats(
  prisma: PrismaClient,
  organizationId: string,
  days: number = 30
) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const stats = await (prisma as PrismaClientWithAudit).auditLog.groupBy({
    by: ["action", "targetTable"],
    where: {
      actorOrgId: organizationId,
      occurredAt: {
        gte: startDate
      }
    },
    _count: {
      id: true
    }
  });

  return stats.map(
    (stat: {
      action: string;
      targetTable: string;
      _count: { id: number };
    }) => ({
      action: stat.action,
      table: stat.targetTable,
      count: stat._count.id
    })
  );
}

/**
 * Clean up old audit logs (for maintenance)
 */
export async function cleanupOldAuditLogs(
  prisma: PrismaClient,
  daysToKeep: number = 365
) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const result = await (prisma as PrismaClientWithAudit).auditLog.deleteMany({
    where: {
      occurredAt: {
        lt: cutoffDate
      }
    }
  });

  return result.count;
}
