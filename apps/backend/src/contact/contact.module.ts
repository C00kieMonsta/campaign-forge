import { Module } from "@nestjs/common";
import { ConfigModule } from "@/config/config.module";
import { ContactController } from "./contact.controller";
import { ContactService } from "./contact.service";
import { RateLimitService } from "./rate-limit.service";

@Module({
  imports: [ConfigModule],
  controllers: [ContactController],
  providers: [ContactService, RateLimitService],
  exports: [ContactService],
})
export class ContactModule {}
