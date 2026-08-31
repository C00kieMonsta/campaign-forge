import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { RagModule } from "../ai/rag.module";
import { AuthoritiesModule } from "../authorities/authorities.module";
import { CaseFileModule } from "../documents/case-file.module";
import { SettingsModule } from "../settings/settings.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ContextAssembler } from "./context-assembler.service";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";
import { SummarizationService } from "./summarization.service";
import { VoiceService } from "./voice.service";

@Module({
  imports: [
    AuthModule,
    WorkspacesModule,
    RagModule,
    SettingsModule,
    AuthoritiesModule,
    CaseFileModule
  ],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    ContextAssembler,
    SummarizationService,
    VoiceService
  ],
  exports: [ConversationsService]
})
export class ConversationsModule {}
