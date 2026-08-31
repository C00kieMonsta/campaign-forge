import { Module } from "@nestjs/common";
import { CaseFileService } from "./case-file.service";

/**
 * The case-file inventory, imported by Conversations and Tasks so CaseFileService is a single
 * instance rather than provided twice. Same reason RagModule exists.
 *
 * Deliberately NOT DocumentsModule: that module brings DocumentsService and the IngestionWorker
 * with it, and the prompt paths need neither. PgService comes from the @Global SharedModule, so
 * this module imports nothing and can never close a dependency cycle.
 */
@Module({
  providers: [CaseFileService],
  exports: [CaseFileService]
})
export class CaseFileModule {}
