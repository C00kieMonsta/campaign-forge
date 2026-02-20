import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { GroupsService } from "./groups.service";
import { AdminGuard } from "../auth/admin.guard";

@Controller("admin/groups")
@UseGuards(AdminGuard)
export class GroupsController {
  constructor(private groups: GroupsService) {}

  @Get()
  list() {
    return this.groups.list();
  }

  @Post()
  create(@Body() body: { name: string; color: string }) {
    return this.groups.create(body);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: { name?: string; color?: string }) {
    return this.groups.update(id, body);
  }

  @Delete(":id")
  delete(@Param("id") id: string) {
    return this.groups.delete(id);
  }
}
