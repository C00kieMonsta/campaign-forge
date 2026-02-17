import { Global, Module } from "@nestjs/common";
import { AuditLogger } from "@/logger/audit-logger.service";
import { NestLogger } from "@/logger/nest.logger";

@Global()
@Module({
  providers: [
    AuditLogger,
    NestLogger,
    {
      provide: "AUDIT_LOGGER",
      useClass: AuditLogger
    }
  ],
  exports: [AuditLogger, NestLogger, "AUDIT_LOGGER"]
})
export class LoggingModule {}
