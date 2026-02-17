import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { ConfigService } from "@/config/config.service";
import { Loggable } from "@/logger/loggable";
import { getCurrentAuditContext } from "./audit-context.provider";
import { attachAuditMiddleware } from "./prisma-audit.middleware";

@Injectable()
export class PrismaService
  extends Loggable
  implements OnModuleInit, OnModuleDestroy
{
  private prisma?: PrismaClient;
  private static auditContextProvider = getCurrentAuditContext;

  constructor(private configService: ConfigService) {
    super();
  }

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect() {
    if (!this.prisma) {
      this.logger.debug({
        message: "Initializing Prisma client",
        ...this.context
      });

      try {
        // Ensure DATABASE_URL is configured
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
          throw new Error(
            "DATABASE_URL environment variable is required. Please ensure it's properly configured in your environment."
          );
        }

        // Log connection attempt (without exposing credentials)
        const safeUrl = databaseUrl.replace(/:([^@]+)@/, ":***@");
        this.logger.info({
          message: "Attempting to connect to database",
          url: safeUrl,
          ...this.context
        });

        // Let Prisma use the environment variables directly
        // It will automatically use DATABASE_URL for runtime and DIRECT_DATABASE_URL for migrations
        this.prisma = new PrismaClient({
          log: ["info", "warn", "error"]
        });

        // Attach audit middleware
        attachAuditMiddleware(this.prisma, PrismaService.auditContextProvider);

        await this.prisma.$connect();

        this.logger.info({
          message: "Prisma client connected successfully",
          ...this.context
        });
      } catch (error) {
        this.logger.error({
          message: "Failed to initialize Prisma client",
          error: error instanceof Error ? error.message : String(error),
          ...this.context
        });
        throw error;
      }
    }
  }

  get client(): PrismaClient {
    if (!this.prisma) {
      throw new Error("Prisma client not initialized. Call connect() first.");
    }
    return this.prisma;
  }

  async disconnect() {
    if (this.prisma) {
      await this.prisma.$disconnect();
      this.logger.info({
        message: "Prisma client disconnected",
        ...this.context
      });
    }
  }

  /**
   * Set the audit context provider (will be used in Phase 3)
   */
  static setAuditContextProvider(provider: () => any) {
    PrismaService.auditContextProvider = provider;
  }

  protected getContext(): Record<string, any> {
    return {
      service: "PrismaService",
      timestamp: new Date().toISOString()
    };
  }
}
