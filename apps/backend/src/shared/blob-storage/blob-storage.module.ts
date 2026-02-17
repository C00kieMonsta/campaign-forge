import { Module } from "@nestjs/common";
import { ConfigModule } from "@/config/config.module";
import { BlobStorageService } from "@/shared/blob-storage/blob-storage.service";

@Module({
  providers: [BlobStorageService],
  exports: [BlobStorageService],
  imports: [ConfigModule]
})
export class BlobStorageModule {}
