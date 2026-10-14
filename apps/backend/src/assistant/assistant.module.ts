import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ContactsModule } from "../contacts/contacts.module";
import { GroupsModule } from "../groups/groups.module";
import { CampaignAssistantController } from "./campaign-assistant.controller";
import { CampaignAssistantService } from "./campaign-assistant.service";
import { ContactAssistantController } from "./contact-assistant.controller";
import { ContactAssistantService } from "./contact-assistant.service";

/**
 * The Campaigns app's two AI assistants. Its own module rather than additions to the campaigns and
 * contacts modules: it needs both of their services plus the shared OpenAI and OCR clients, and
 * nothing in it is needed by them.
 */
@Module({
  imports: [AuthModule, ContactsModule, GroupsModule],
  controllers: [CampaignAssistantController, ContactAssistantController],
  providers: [CampaignAssistantService, ContactAssistantService]
})
export class AssistantModule {}
