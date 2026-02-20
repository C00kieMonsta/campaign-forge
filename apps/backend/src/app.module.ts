import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { SharedModule } from "./shared/shared.module";
import { ContactsModule } from "./contacts/contacts.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
import { GroupsModule } from "./groups/groups.module";
import { PublicModule } from "./public/public.module";
import { AuthModule } from "./auth/auth.module";

@Module({
  imports: [ConfigModule, SharedModule, ContactsModule, CampaignsModule, GroupsModule, PublicModule, AuthModule],
})
export class AppModule {}
