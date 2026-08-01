import { Module } from "@nestjs/common";
import { SharedModule } from "../../shared/shared.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { StoryController } from "./story.controller";
import { StoryService } from "./story.service";

@Module({
  imports: [SharedModule, WorkspacesModule],
  controllers: [StoryController],
  providers: [StoryService]
})
export class StoryModule {}
