import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { AdminGuard } from "../../auth/admin.guard";
import type { AuthUser } from "../../auth/admin.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import { StoryService } from "./story.service";

@UseGuards(AdminGuard)
@Controller("admin/lex")
export class StoryController {
  constructor(private story: StoryService) {}

  /**
   * The amounts a case file states, each with the sentence it came from.
   *
   * A GET with no side effects and no model call: it scans stored text every time rather than reading
   * a table, so it can never be stale, and there is nothing to trigger or wait for. Measured on the
   * dev corpus the underlying scan is ~190 ms.
   */
  @Get("workspaces/:workspaceId/story")
  async storyFor(
    @CurrentUser() user: AuthUser,
    @Param("workspaceId") workspaceId: string
  ) {
    return this.story.story(user.email, workspaceId);
  }
}
