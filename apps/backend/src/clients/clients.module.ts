import { Module } from "@nestjs/common";
import { ClientsController } from "@/clients/clients.controller";
import { ClientsService } from "@/clients/clients.service";
import { DatabaseModule } from "@/shared/database/database.module";
import { SharedModule } from "@/shared/shared.module";

@Module({
  imports: [SharedModule, DatabaseModule],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService]
})
export class ClientsModule {}
