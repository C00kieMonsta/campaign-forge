import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards
} from "@nestjs/common";
import {
  completeAuthorityUploadRequestSchema,
  presignAuthorityRequestSchema,
  updateAuthorityRequestSchema
} from "@packages/types";
import { AdminGuard } from "../../auth/admin.guard";
import type { AuthUser } from "../../auth/admin.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import { formatZodError } from "../../shared/validation";
import { AuthoritiesService } from "./authorities.service";

/**
 * Authorities are OWNER-scoped, so no route here takes a workspace id: a code the user has
 * uploaded applies to every one of their cases.
 *
 * Route order matters — Nest matches in declaration order, so every literal segment
 * ("presign", "complete-upload") is declared before the ":id" routes that would otherwise
 * swallow it.
 */
@UseGuards(AdminGuard)
@Controller("admin/lex")
export class AuthoritiesController {
  constructor(private authorities: AuthoritiesService) {}

  /**
   * Reserve upload slots. The bytes go browser → S3 directly via the returned presigned PUTs; a
   * code is exactly the multi-tens-of-MB PDF that nginx (10 MB body cap in prod) would refuse.
   */
  @Post("authorities/presign")
  async presign(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = presignAuthorityRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(formatZodError(parsed.error));
    return this.authorities.presignUploads(user.email, parsed.data.files);
  }

  /** Confirm the direct uploads landed and queue them for article-aware ingestion. */
  @Post("authorities/complete-upload")
  async completeUpload(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = completeAuthorityUploadRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(formatZodError(parsed.error));
    return this.authorities.completeUploads(
      user.email,
      parsed.data.authorityIds
    );
  }

  @Get("authorities")
  async list(@CurrentUser() user: AuthUser) {
    const items = await this.authorities.list(user.email);
    return { items };
  }

  /** The article map injected into every chat turn — a sub-resource, off the list response. */
  @Get("authorities/:id/digest")
  async digest(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const digest = await this.authorities.getDigest(user.email, id);
    return { digest };
  }

  /** Retitle, or take an authority out of every prompt without losing its index. */
  @Patch("authorities/:id")
  async update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    const parsed = updateAuthorityRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(formatZodError(parsed.error));
    const authority = await this.authorities.update(
      user.email,
      id,
      parsed.data
    );
    return { authority };
  }

  /** Re-queue ingestion from the stored bytes (a transient outage, a crash mid-code). */
  @Post("authorities/:id/retry")
  async retry(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const authority = await this.authorities.retry(user.email, id);
    return { authority };
  }

  @Delete("authorities/:id")
  async delete(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.authorities.delete(user.email, id);
    return { ok: true as const };
  }
}
