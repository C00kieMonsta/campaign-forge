import { Global, Module } from "@nestjs/common";
import { DdbService } from "./ddb.service";
import { LexS3Service } from "./lex-s3.service";
import { OpenAiService } from "./openai.service";
import { PgService } from "./pg.service";
import { S3Service } from "./s3.service";
import { SecretsService } from "./secrets.service";
import { SesService } from "./ses.service";
import { TokenService } from "./token.service";

// Lex services are lazy-init and inert until first use, so registering them here is safe
// even before the Lex infrastructure (RDS, OpenAI key, docs bucket) exists.
const providers = [
  DdbService,
  S3Service,
  SesService,
  TokenService,
  PgService,
  SecretsService,
  OpenAiService,
  LexS3Service
];

@Global()
@Module({
  providers,
  exports: providers
})
export class SharedModule {}
