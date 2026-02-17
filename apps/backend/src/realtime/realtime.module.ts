import { Module } from "@nestjs/common";
import { PgListenerService } from "./pg-listener.service";
import { RealtimeGateway } from "./realtime.gateway";

@Module({
  providers: [PgListenerService, RealtimeGateway],
  exports: [PgListenerService]
})
export class RealtimeModule {}
