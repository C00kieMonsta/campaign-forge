import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";
import {
  completeUploadRequestSchema,
  deleteDocumentsRequestSchema,
  discardDocumentsRequestSchema,
  presignUploadRequestSchema,
  updateTranscriptRequestSchema
} from "@packages/types";
import { AdminGuard } from "../../auth/admin.guard";
import type { AuthUser } from "../../auth/admin.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import { formatZodError } from "../../shared/validation";
import { DocumentsService } from "./documents.service";

@UseGuards(AdminGuard)
@Controller("admin/lex")
export class DocumentsController {
  constructor(private documents: DocumentsService) {}

  /**
   * Reserve upload slots. Documents go browser → S3 directly via the returned presigned PUTs;
   * their bytes never pass through this API (nginx caps request bodies at 10 MB in production,
   * and buffering a 100 MB scan on the shared box is not something we want either).
   */
  @Post("workspaces/:workspaceId/documents/presign")
  async presign(
    @CurrentUser() user: AuthUser,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown
  ) {
    const parsed = presignUploadRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(formatZodError(parsed.error));
    return this.documents.presignUploads(
      user.email,
      workspaceId,
      parsed.data.files
    );
  }

  /** Confirm the direct uploads landed and queue them for ingestion. */
  @Post("documents/complete-upload")
  async completeUpload(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = completeUploadRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(formatZodError(parsed.error));
    return this.documents.completeUploads(user.email, parsed.data.documentIds);
  }

  @Get("documents/:id/view")
  async view(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.viewUrl(user.email, id);
  }

  /** Voice notes: read the transcript (the audio itself is re-listened to via /view). */
  @Get("documents/:id/transcript")
  async transcript(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const transcript = await this.documents.getTranscript(user.email, id);
    return { transcript };
  }

  /** Save a hand-corrected transcript; the document is re-indexed from it. */
  @Patch("documents/:id/transcript")
  async saveTranscript(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    const parsed = updateTranscriptRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(formatZodError(parsed.error));
    const transcript = await this.documents.updateTranscript(
      user.email,
      id,
      parsed.data.transcript
    );
    return { transcript };
  }

  /**
   * Re-summarize every ready document the user owns, in their pinned language. Offered from
   * Settings after changing the language, so existing documents catch up.
   */
  @Post("documents/resummarize-all")
  async resummarizeAll(@CurrentUser() user: AuthUser) {
    return this.documents.resummarizeAll(user.email);
  }

  /** Re-run speech-to-text on the stored audio (one-off, discards the current transcript). */
  @Post("documents/:id/retranscribe")
  async retranscribe(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const document = await this.documents.retranscribe(user.email, id);
    return { document };
  }

  @Get("workspaces/:workspaceId/documents")
  async list(
    @CurrentUser() user: AuthUser,
    @Param("workspaceId") workspaceId: string,
    @Query("status") status?: string
  ) {
    const items = await this.documents.list(user.email, workspaceId, status);
    return { items };
  }

  @Get("workspaces/:workspaceId/timeline")
  async timeline(
    @CurrentUser() user: AuthUser,
    @Param("workspaceId") workspaceId: string
  ) {
    const items = await this.documents.timeline(user.email, workspaceId);
    return { items };
  }

  @Get("documents/:id")
  async get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const document = await this.documents.getOrFail(user.email, id);
    return { document };
  }

  @Get("documents/:id/status")
  async status(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.statusOf(user.email, id);
  }

  /** Re-queue ingestion from the stored bytes (transient OCR outages, crashes mid-batch). */
  @Post("documents/:id/retry")
  async retry(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const document = await this.documents.retry(user.email, id);
    return { document };
  }

  /** Multi-select deletion. */
  @Post("documents/bulk-delete")
  async bulkDelete(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = deleteDocumentsRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(formatZodError(parsed.error));
    return this.documents.deleteMany(user.email, parsed.data.documentIds);
  }

  /** Clear out every stuck / unparseable / duplicate document in a workspace at once. */
  @Post("workspaces/:workspaceId/documents/discard")
  async discard(
    @CurrentUser() user: AuthUser,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown
  ) {
    const parsed = discardDocumentsRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(formatZodError(parsed.error));
    return this.documents.discardByStatus(
      user.email,
      workspaceId,
      parsed.data.statuses
    );
  }

  @Delete("documents/:id")
  async delete(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.documents.delete(user.email, id);
    return { ok: true as const };
  }
}
