import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { IngestionWorker } from "./ingestion.worker";
import { MistralOcrService } from "./mistral-ocr.service";

@Module({
  imports: [AuthModule, WorkspacesModule, SettingsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, IngestionWorker, MistralOcrService],
  exports: [DocumentsService]
})
export class DocumentsModule {}
