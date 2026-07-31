import { Module } from "@nestjs/common";
import { ArtifactsModule } from "./artifacts/artifacts.module";
import { AuthoritiesModule } from "./authorities/authorities.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { DocumentsModule } from "./documents/documents.module";
import { SettingsModule } from "./settings/settings.module";
import { TasksModule } from "./tasks/tasks.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";

/** Aggregator for the Lex legal-RAG app. app.module imports only this. */
@Module({
  imports: [
    SettingsModule,
    WorkspacesModule,
    DocumentsModule,
    AuthoritiesModule,
    ConversationsModule,
    ArtifactsModule,
    TasksModule
  ]
})
export class LexModule {}
