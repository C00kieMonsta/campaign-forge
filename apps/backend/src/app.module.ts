import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { SharedModule } from "./shared/shared.module";
import { ContactsModule } from "./contacts/contacts.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
import { GroupsModule } from "./groups/groups.module";
import { PublicModule } from "./public/public.module";
import { AuthModule } from "./auth/auth.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [ConfigModule, SharedModule, ContactsModule, CampaignsModule, GroupsModule, PublicModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
