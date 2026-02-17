import { Module } from "@nestjs/common";
import { ConfigModule } from "@/config/config.module";
import { ExtractionModule } from "@/extraction/extraction.module";
import { FilesController } from "@/files/files.controller";
import { FilesService } from "@/files/files.service";
import { DatabaseModule } from "@/shared/database/database.module";
import { SharedModule } from "@/shared/shared.module";

@Module({
  imports: [ConfigModule, SharedModule, DatabaseModule, ExtractionModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService]
})
export class FilesModule {}
