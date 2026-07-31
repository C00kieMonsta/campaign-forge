import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { RagModule } from "../ai/rag.module";
import { AuthoritiesModule } from "../authorities/authorities.module";
import { SettingsModule } from "../settings/settings.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ContextAssembler } from "./context-assembler.service";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";
import { SummarizationService } from "./summarization.service";

@Module({
  imports: [
    AuthModule,
    WorkspacesModule,
    RagModule,
    SettingsModule,
    AuthoritiesModule
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService, ContextAssembler, SummarizationService],
  exports: [ConversationsService]
})
export class ConversationsModule {}
