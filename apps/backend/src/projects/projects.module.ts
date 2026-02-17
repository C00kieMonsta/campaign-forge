import { Module } from "@nestjs/common";
import { ConfigModule } from "@/config/config.module";
import { ProjectsController } from "@/projects/projects.controller";
import { ProjectsService } from "@/projects/projects.service";
import { DatabaseModule } from "@/shared/database/database.module";
import { SharedModule } from "@/shared/shared.module";
import { SuppliersModule } from "@/suppliers/suppliers.module";

@Module({
  imports: [ConfigModule, SharedModule, DatabaseModule, SuppliersModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService]
})
export class ProjectsModule {}
