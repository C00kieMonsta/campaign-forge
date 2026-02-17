import { Injectable } from "@nestjs/common";
import { Loggable } from "@/logger/loggable";
import { cleanupOldAuditLogs, getAuditStats } from "./audit-utils";
// TODO: Install @nestjs/schedule package and uncomment the following line
// import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "./prisma.service";

/**
 * Service for managing audit logs - cleanup, archival, and monitoring
 */
@Injectable()
export class AuditManagementService extends Loggable {
  constructor(private prismaService: PrismaService) {
    super();
  }

  /**
   * Automatic cleanup of old audit logs - runs daily at 2 AM
   * TODO: Uncomment @Cron decorator when @nestjs/schedule is installed
   */
  // @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async automaticCleanup() {
    const daysToKeep = parseInt("365");

    this.logger.info({
      message: "Starting automatic audit log cleanup",
      daysToKeep,
      ...this.context
    });

    try {
      const deletedCount = await cleanupOldAuditLogs(
        this.prismaService.client,
        daysToKeep
      );

      this.logger.info({
        message: "Audit log cleanup completed",
        deletedCount,
        daysToKeep,
        ...this.context
      });
    } catch (error) {
      this.logger.error({
        message: "Audit log cleanup failed",
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
    }
  }

  /**
   * Generate audit statistics report - runs weekly on Sundays at 6 AM
   * TODO: Uncomment @Cron decorator when @nestjs/schedule is installed
   */
  // @Cron(CronExpression.EVERY_SUNDAY_AT_NOON)
  async generateWeeklyReport() {
    this.logger.info({
      message: "Generating weekly audit statistics report",
      ...this.context
    });

    try {
      // Get audit stats for all organizations
      const organizations =
        await this.prismaService.client.organization.findMany({
          select: { id: true, name: true, slug: true }
        });

      for (const org of organizations) {
        const stats = await getAuditStats(this.prismaService.client, org.id, 7); // Last 7 days

        this.logger.info({
          message: "Weekly audit statistics",
          organizationId: org.id,
          organizationName: org.name,
          stats: stats.reduce(
            (acc: Record<string, number>, stat: any) => {
              acc[`${stat.table}_${stat.action}`] = stat.count;
              return acc;
            },
            {} as Record<string, number>
          ),
          ...this.context
        });
      }
    } catch (error) {
      this.logger.error({
        message: "Failed to generate audit statistics report",
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
    }
  }

  /**
   * Manual cleanup of audit logs
   */
  async manualCleanup(daysToKeep: number): Promise<number> {
    this.logger.info({
      message: "Starting manual audit log cleanup",
      daysToKeep,
      ...this.context
    });

    try {
      const deletedCount = await cleanupOldAuditLogs(
        this.prismaService.client,
        daysToKeep
      );

      this.logger.info({
        message: "Manual audit log cleanup completed",
        deletedCount,
        daysToKeep,
        ...this.context
      });

      return deletedCount;
    } catch (error) {
      this.logger.error({
        message: "Manual audit log cleanup failed",
        error: error instanceof Error ? error.message : String(error),
        ...this.context
      });
      throw error;
    }
  }

  /**
   * Get audit health metrics
   */
  async getAuditHealth(): Promise<{
    totalRecords: number;
    oldestRecord: Date | null;
    newestRecord: Date | null;
    averageRecordsPerDay: number;
    topTables: Array<{ table: string; count: number }>;
  }> {
    const prisma = this.prismaService.client as any;

    const [totalCount, oldestRecord, newestRecord, tableStats] =
      await Promise.all([
        prisma.auditLog.count(),
        prisma.auditLog.findFirst({
          orderBy: { occurredAt: "asc" },
          select: { occurredAt: true }
        }),
        prisma.auditLog.findFirst({
          orderBy: { occurredAt: "desc" },
          select: { occurredAt: true }
        }),
        prisma.auditLog.groupBy({
          by: ["targetTable"],
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
          take: 10
        })
      ]);

    // Calculate average records per day
    let averageRecordsPerDay = 0;
    if (oldestRecord && newestRecord) {
      const daysDiff = Math.max(
        1,
        Math.ceil(
          (newestRecord.occurredAt.getTime() -
            oldestRecord.occurredAt.getTime()) /
            (1000 * 60 * 60 * 24)
        )
      );
      averageRecordsPerDay = Math.round(totalCount / daysDiff);
    }

    return {
      totalRecords: totalCount,
      oldestRecord: oldestRecord?.occurredAt || null,
      newestRecord: newestRecord?.occurredAt || null,
      averageRecordsPerDay,
      topTables: tableStats.map((stat: any) => ({
        table: stat.targetTable,
        count: stat._count.id
      }))
    };
  }

  protected getContext(): Record<string, any> {
    return {
      service: "AuditManagementService",
      timestamp: new Date().toISOString()
    };
  }
}
