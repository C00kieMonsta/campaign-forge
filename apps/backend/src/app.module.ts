import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { SharedModule } from "./shared/shared.module";
import { ContactsModule } from "./contacts/contacts.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
import { PublicModule } from "./public/public.module";

@Module({
  imports: [ConfigModule, SharedModule, ContactsModule, CampaignsModule, PublicModule],
})
export class AppModule {}
