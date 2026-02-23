import { Global, Module } from "@nestjs/common";
import { DdbService } from "./ddb.service";
import { S3Service } from "./s3.service";
import { SesService } from "./ses.service";
import { TokenService } from "./token.service";

@Global()
@Module({
  providers: [DdbService, S3Service, SesService, TokenService],
  exports: [DdbService, S3Service, SesService, TokenService],
})
export class SharedModule {}
