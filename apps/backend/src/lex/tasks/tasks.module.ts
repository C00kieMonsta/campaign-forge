import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { ConversationsModule } from "../conversations/conversations.module";
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
 */
@Module({
  imports: [AuthModule, WorkspacesModule, SettingsModule, ConversationsModule],
  controllers: [TasksController],
  providers: [TasksService, TaskRunner],
  exports: [TasksService]
})
export class TasksModule {}
