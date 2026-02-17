import { Module } from "@nestjs/common";
import { BlobStorageModule } from "@/shared/blob-storage/blob-storage.module";
import { HealthModule } from "@/shared/health/health.module";
import { LLMModule } from "@/shared/llm/llm.module";
import { PrismaModule } from "@/shared/prisma/prisma.module";

@Module({
  imports: [BlobStorageModule, HealthModule, LLMModule, PrismaModule],
  exports: [BlobStorageModule, HealthModule, LLMModule, PrismaModule]
})
export class SharedModule {}

// Re-export utilities for easy importing
export * from "@/shared/utils";
