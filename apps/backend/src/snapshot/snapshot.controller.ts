import {
  Controller,
  Get,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import type { Response } from "express";
import { AdminGuard } from "../auth/admin.guard";
import type { AuthUser } from "../auth/admin.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SNAPSHOT_DOWNLOAD_PURPOSE } from "./snapshot-archive";
import { SnapshotService } from "./snapshot.service";

/**
 * Settings → full data snapshot. Shell-level, not an app's: it covers the Campaigns tables, the
 * Lex database and both buckets in one archive.
 *
 * The download is a plain navigation, not a fetch: the zip can run to gigabytes and the browser
 * must stream it to disk itself. A navigation carries no bearer header, so the download route takes
 * a short-lived ticket in the query string instead, minted by the guarded route just before.
 */
@Controller("admin/snapshot")
export class SnapshotController {
  constructor(
    private snapshot: SnapshotService,
    private adminGuard: AdminGuard
  ) {}

  @UseGuards(AdminGuard)
  @Get("inventory")
  async inventory() {
    return this.snapshot.inventory();
  }

  @UseGuards(AdminGuard)
  @Post("download-ticket")
  downloadTicket(@CurrentUser() user: AuthUser) {
    console.log(
      JSON.stringify({
        level: "info",
        action: "snapshotTicketIssued",
        email: user.email
      })
    );
    return this.snapshot.issueDownloadTicket(user.email);
  }

  @Get("download")
  async download(@Query("token") token: unknown, @Res() res: Response) {
    if (typeof token !== "string" || token.length === 0) {
      throw new UnauthorizedException("Missing download token");
    }
    const user = this.adminGuard.verifyToken(token, {
      purpose: SNAPSHOT_DOWNLOAD_PURPOSE
    });

    const planned = await this.snapshot.plan();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${planned.filename}"`
    );
    res.setHeader("Cache-Control", "no-store");

    console.log(
      JSON.stringify({
        level: "info",
        action: "snapshotDownloadStarted",
        email: user.email,
        filename: planned.filename
      })
    );
    await this.snapshot.write(planned, res);
    console.log(
      JSON.stringify({
        level: "info",
        action: "snapshotDownloadCompleted",
        email: user.email,
        filename: planned.filename
      })
    );
  }
}
