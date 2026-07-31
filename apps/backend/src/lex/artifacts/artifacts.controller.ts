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
import {
  generateArtifactRequestSchema,
  saveArtifactRequestSchema
} from "@packages/types";
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

  @Post("artifacts/generate")
  async generate(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = generateArtifactRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(formatZodError(parsed.error));
    }
    return this.artifacts.generate(user.email, parsed.data);
  }

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
    return this.artifacts.saveVersion(user.email, id, parsed.data.bodyJson);
  }

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
