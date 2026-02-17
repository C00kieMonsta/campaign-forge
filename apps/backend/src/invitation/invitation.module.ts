import { Module } from "@nestjs/common";
import { ConfigModule } from "@/config/config.module";
import { InvitationController } from "@/invitation/invitation.controller";
import { InvitationService } from "@/invitation/invitation.service";

@Module({
  imports: [ConfigModule],
  controllers: [InvitationController],
  providers: [InvitationService],
  exports: [InvitationService]
})
export class InvitationModule {}
