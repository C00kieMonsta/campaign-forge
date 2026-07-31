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
  createWorkspaceRequestSchema,
  updateWorkspaceRequestSchema
} from "@packages/types";
import { AdminGuard } from "../../auth/admin.guard";
import type { AuthUser } from "../../auth/admin.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import { formatZodError } from "../../shared/validation";
import { WorkspacesService } from "./workspaces.service";

@UseGuards(AdminGuard)
@Controller("admin/lex/workspaces")
export class WorkspacesController {
  constructor(private workspaces: WorkspacesService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const items = await this.workspaces.list(user.email);
    return { items, cursor: null };
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = createWorkspaceRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(formatZodError(parsed.error));
    const workspace = await this.workspaces.create(user.email, parsed.data);
    return { workspace };
  }

  @Get(":id")
  async get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const workspace = await this.workspaces.getOrFail(user.email, id);
    return { workspace };
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    const parsed = updateWorkspaceRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(formatZodError(parsed.error));
    const workspace = await this.workspaces.update(user.email, id, parsed.data);
    return { workspace };
  }

  @Delete(":id")
  async delete(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.workspaces.delete(user.email, id);
    return { ok: true as const };
  }
}
