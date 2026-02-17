import { Module } from "@nestjs/common";
import { ConfigModule } from "@/config/config.module";
import { HealthController } from "@/shared/health/health.controller";

@Module({
  imports: [ConfigModule],
  controllers: [HealthController]
})
export class HealthModule {}
