import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

/**
 * User settings (the pinned language). Exported because the language pin is consumed by every
 * subsystem that generates user-facing text: conversations, artifacts and document ingestion.
 */
@Module({
  imports: [AuthModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService]
})
export class SettingsModule {}
