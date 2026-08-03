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
  Res,
  UseGuards
} from "@nestjs/common";
import { saveArtifactRequestSchema } from "@packages/types";
import type { Response } from "express";
import { AdminGuard } from "../../auth/admin.guard";
import type { AuthUser } from "../../auth/admin.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import { formatZodError } from "../../shared/validation";
import { ArtifactsService } from "./artifacts.service";
import { ExportService } from "./export.service";

@UseGuards(AdminGuard)
@Controller("admin/lex")
export class ArtifactsController {
  constructor(
    private artifacts: ArtifactsService,
    private exporter: ExportService
  ) {}

  @Get("workspaces/:workspaceId/artifacts")
  async list(
    @CurrentUser() user: AuthUser,
    @Param("workspaceId") workspaceId: string
  ) {
    const items = await this.artifacts.list(user.email, workspaceId);
    return { items };
  }

  // NO synchronous `POST artifacts/generate`. Drafting reads up to 200 passages and then spends one
  // frontier-model judge per claim; that outlived nginx's default 60s read timeout on this route,
  // and its 504 carries no CORS header, so the browser reported a CORS failure and hid the cause.
  // Generation is `POST tasks` with kind 'generate_artifact' — one path, on the background runner,
  // durable across a closed tab. ArtifactsService.generate still exists; the runner calls it.

  @Get("artifacts/:id")
  async get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.artifacts.getWithVersion(user.email, id);
  }

  @Patch("artifacts/:id")
  async save(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    const parsed = saveArtifactRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(formatZodError(parsed.error));
    }
    return this.artifacts.saveVersion(
      user.email,
      id,
      parsed.data.bodyJson,
      parsed.data.dropCitedClaimIds
    );
  }

  // NO synchronous `POST artifacts/:id/verify`, for the same reason there is no synchronous
  // generate: re-verification is one frontier-model judge per claim it has to re-check, which
  // outlives nginx's default 60s read timeout on this route. It is `POST tasks` with kind
  // 'verify_artifact'; the runner calls ArtifactsService.reverify.

  @Post("artifacts/:id/signoff")
  async signOff(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.artifacts.signOff(user.email, id);
  }

  @Delete("artifacts/:id")
  async delete(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.artifacts.delete(user.email, id);
    return { ok: true as const };
  }

  /** Renders a print-ready HTML document. `verifiedOnly=true` hard-blocks unless verified + signed off. */
  @Get("artifacts/:id/export")
  async export(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("verifiedOnly") verifiedOnly: string,
    @Res() res: Response
  ) {
    const { artifact, version } = await this.artifacts.getWithVersion(
      user.email,
      id
    );
    const html = this.exporter.renderHtml(artifact, version, {
      verifiedOnly: verifiedOnly === "true"
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  }
}
