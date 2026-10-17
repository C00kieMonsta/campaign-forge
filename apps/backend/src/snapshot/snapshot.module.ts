import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SnapshotController } from "./snapshot.controller";
import { SnapshotService } from "./snapshot.service";

/** Full data export for an account move. Reads every store through SharedModule's services. */
@Module({
  imports: [AuthModule],
  controllers: [SnapshotController],
  providers: [SnapshotService]
})
export class SnapshotModule {}
