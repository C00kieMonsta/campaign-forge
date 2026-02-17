import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@/config/config.module";
import { AuditManagementController } from "@/shared/prisma/audit-management.controller";
import { AuditManagementService } from "@/shared/prisma/audit-management.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [AuditManagementController],
  providers: [PrismaService, AuditManagementService],
  exports: [PrismaService, AuditManagementService]
})
export class PrismaModule {}
