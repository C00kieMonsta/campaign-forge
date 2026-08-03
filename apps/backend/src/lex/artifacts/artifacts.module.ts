import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { RagModule } from "../ai/rag.module";
import { SettingsModule } from "../settings/settings.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ArtifactGenerationService } from "./artifact-generation.service";
import { ArtifactsController } from "./artifacts.controller";
import { ArtifactsService } from "./artifacts.service";
import { ExportService } from "./export.service";
import { ReverificationService } from "./reverification.service";
import { VerificationService } from "./verification.service";

@Module({
  imports: [AuthModule, WorkspacesModule, RagModule, SettingsModule],
  controllers: [ArtifactsController],
  providers: [
    ArtifactsService,
    ArtifactGenerationService,
    VerificationService,
    ReverificationService,
    ExportService
  ],
  // TasksModule needs it: document generation runs on the background task runner, because the
  // work outlives an HTTP request.
  exports: [ArtifactsService]
})
export class ArtifactsModule {}
