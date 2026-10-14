import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { IngestionWorker } from "./ingestion.worker";

@Module({
  imports: [AuthModule, WorkspacesModule, SettingsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, IngestionWorker],
  exports: [DocumentsService]
})
export class DocumentsModule {}
