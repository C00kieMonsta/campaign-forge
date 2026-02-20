import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AdminGuard } from "./admin.guard";
import { ConfigModule } from "../config/config.module";

@Module({
  imports: [ConfigModule],
  controllers: [AuthController],
  providers: [AdminGuard],
  exports: [AdminGuard],
})
export class AuthModule {}
