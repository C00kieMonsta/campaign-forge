// Temporarily commented out due to missing dependencies and types
/*
import { Module } from "@nestjs/common";
import { EmailController } from "@/shared/emailemail.controller";
import { EmailService } from "@/shared/emailemail.service";
import { SESClient } from "@/shared/emailses-client";

@Module({
  controllers: [EmailController],
  providers: [EmailService, SESClient],
  exports: [EmailService],
})
export class EmailModule {}
*/
