import { Module } from "@nestjs/common";
import { RagService } from "./rag.service";

/** Shared retrieval layer — imported by Conversations and Artifacts so RagService is a
 * single instance rather than provided twice. */
@Module({
  providers: [RagService],
  exports: [RagService]
})
export class RagModule {}
