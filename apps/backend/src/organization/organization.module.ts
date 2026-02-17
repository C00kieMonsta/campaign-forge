import { Module } from "@nestjs/common";
import { JWTVerificationService } from "@/auth/jwt-verification.service";
import { ConfigModule } from "@/config/config.module";
import { OrganizationController } from "@/organization/organization.controller";
import { OrganizationService } from "@/organization/organization.service";
import { DatabaseModule } from "@/shared/database/database.module";
import { InvitationEmailService } from "@/shared/email/invitation-email.service";
import { SharedModule } from "@/shared/shared.module";

@Module({
  imports: [ConfigModule, SharedModule, DatabaseModule],
  controllers: [OrganizationController],
  providers: [
    OrganizationService,
    InvitationEmailService,
    JWTVerificationService
  ],
  exports: [OrganizationService]
})
export class OrganizationModule {}
