import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { AuthoritiesController } from "./authorities.controller";
import { AuthoritiesService } from "./authorities.service";
import { AuthorityIngestionWorker } from "./authority-ingestion.worker";

/**
 * Authorities: the law the user uploads, and the article-aware ingestion behind it. PgService,
 * LexS3Service and OpenAiService come from the @Global SharedModule, so only AuthModule (the
 * guard) and SettingsModule (the pinned output language) are imported.
 *
 * AuthoritiesService is exported because the chat prompt consumes it on every turn — the digests
 * of the enabled authorities, plus retrieval over their articles.
 */
@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [AuthoritiesController],
  providers: [AuthoritiesService, AuthorityIngestionWorker],
  exports: [AuthoritiesService]
})
export class AuthoritiesModule {}
