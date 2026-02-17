import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { ConfigService } from "@/config/config.service";
import { Loggable } from "@/logger/loggable";
import { PrismaService } from "@/shared/prisma/prisma.service";

@Injectable()
export abstract class BaseDatabaseService extends Loggable {
  protected get prisma(): PrismaClient {
    return this.prismaService.client;
  }

  constructor(
    protected prismaService: PrismaService,
    protected configService: ConfigService
  ) {
    super();
  }

  protected getContext(): Record<string, any> {
    return {
      service: this.constructor.name,
      timestamp: new Date().toISOString()
    };
  }
}
