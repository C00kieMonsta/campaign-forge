import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [ContactsModule, AuthModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
