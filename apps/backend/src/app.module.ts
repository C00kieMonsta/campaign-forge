import { Module } from "@nestjs/common";
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
