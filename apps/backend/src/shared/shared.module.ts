import { Global, Module } from "@nestjs/common";
import { DdbService } from "./ddb.service";
import { SesService } from "./ses.service";
import { TokenService } from "./token.service";

@Global()
@Module({
  providers: [DdbService, SesService, TokenService],
  exports: [DdbService, SesService, TokenService],
})
export class SharedModule {}
