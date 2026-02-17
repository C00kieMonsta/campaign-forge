import { Module } from "@nestjs/common";
import { ConfigModule } from "@/config/config.module";
import { BlobStorageModule } from "@/shared/blob-storage/blob-storage.module";
import { DatabaseModule } from "@/shared/database/database.module";
import { LLMController } from "@/shared/llm/llm.controller";
import { LLMService } from "@/shared/llm/llm.service";
import { AnthropicService } from "@/shared/llm/services/anthropic.service";
import { GeminiService } from "@/shared/llm/services/gemini.service";
import { OpenAIService } from "@/shared/llm/services/openai.service";

@Module({
  imports: [ConfigModule, BlobStorageModule, DatabaseModule],
  controllers: [LLMController],
  providers: [LLMService, AnthropicService, OpenAIService, GeminiService],
  exports: [LLMService, AnthropicService, OpenAIService, GeminiService]
})
export class LLMModule {}
