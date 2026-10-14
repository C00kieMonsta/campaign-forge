import { Module } from "@nestjs/common";
import { AssistantModule } from "./assistant/assistant.module";
import { AuthModule } from "./auth/auth.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
import { ConfigModule } from "./config/config.module";
import { ContactsModule } from "./contacts/contacts.module";
import { GroupsModule } from "./groups/groups.module";
import { HealthController } from "./health.controller";
import { LexModule } from "./lex/lex.module";
import { PublicModule } from "./public/public.module";
import { SharedModule } from "./shared/shared.module";

@Module({
  imports: [
    ConfigModule,
    SharedModule,
    // Before Contacts and Campaigns so its literal routes (admin/contacts/assistant/extract,
    // admin/campaigns/assistant/turn) are registered ahead of their parameter routes.
    AssistantModule,
    ContactsModule,
    CampaignsModule,
    GroupsModule,
    PublicModule,
    AuthModule,
    LexModule
  ],
  controllers: [HealthController]
})
export class AppModule {}
