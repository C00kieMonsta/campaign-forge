import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "@/auth/auth.controller";
import { AuthService } from "@/auth/auth.service";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { JWTVerificationService } from "@/auth/jwt-verification.service";
import { ConfigModule } from "@/config/config.module";
import { OrganizationService } from "@/organization/organization.service";
import { DatabaseModule } from "@/shared/database/database.module";
import { InvitationEmailService } from "@/shared/email/invitation-email.service";

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    JWTVerificationService,
    OrganizationService,
    InvitationEmailService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard
    }
  ],
  exports: [AuthService]
})
export class AuthModule {}
