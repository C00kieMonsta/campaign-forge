import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { ArtifactsModule } from "../artifacts/artifacts.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { CaseFileModule } from "../documents/case-file.module";
import { SettingsModule } from "../settings/settings.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { TaskRunner } from "./task-runner.service";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

/**
 * Background reasoning tasks. ConversationsModule is imported for ConversationsService — a task's
 * answer is posted into a conversation, and the conversation is created up front when the client
 * did not name one. PgService, OpenAiService and ConfigService come from the @Global SharedModule
 * and ConfigModule, so they are not listed here.
 *
 * ArtifactsModule is imported for ArtifactsService: `generate_artifact` runs here rather than in a
 * request handler, because drafting plus one frontier-model judge per claim outlives nginx's
 * default 60s read timeout.
 */
@Module({
  imports: [
    AuthModule,
    WorkspacesModule,
    SettingsModule,
    ConversationsModule,
    ArtifactsModule,
    CaseFileModule
  ],
  controllers: [TasksController],
  providers: [TasksService, TaskRunner],
  exports: [TasksService]
})
export class TasksModule {}
