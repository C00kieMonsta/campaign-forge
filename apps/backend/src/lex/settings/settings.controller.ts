import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  UseGuards
} from "@nestjs/common";
import { updateSettingsRequestSchema } from "@packages/types";
import { AdminGuard } from "../../auth/admin.guard";
import type { AuthUser } from "../../auth/admin.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import { formatZodError } from "../../shared/validation";
import { SettingsService } from "./settings.service";

@UseGuards(AdminGuard)
@Controller("admin/lex")
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get("settings")
  async get(@CurrentUser() user: AuthUser) {
    const settings = await this.settings.get(user.email);
    return { settings };
  }

  @Patch("settings")
  async update(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = updateSettingsRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(formatZodError(parsed.error));
    const settings = await this.settings.update(
      user.email,
      parsed.data.language
    );
    return { settings };
  }
}
