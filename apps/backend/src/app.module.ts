import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AppController } from "@/app.controller";
import { AppService } from "@/app.service";
import { AuthModule } from "@/auth/auth.module";
import { ClientsModule } from "@/clients/clients.module";
import { ConfigModule } from "@/config/config.module";
import { ContactModule } from "@/contact/contact.module";
import { ExtractionModule } from "@/extraction/extraction.module";
import { FilesModule } from "@/files/files.module";
import { InvitationModule } from "@/invitation/invitation.module";
import { AuditInterceptor } from "@/logger/audit.interceptor";
import { LoggingModule } from "@/logger/logging.module";
import { OrganizationModule } from "@/organization/organization.module";
import { ProjectsModule } from "@/projects/projects.module";
import { RealtimeModule } from "@/realtime/realtime.module";
import { DatabaseModule } from "@/shared/database/database.module";
import { CacheControlInterceptor } from "@/shared/interceptors/cache-control.interceptor";
import { JsonSerializerInterceptor } from "@/shared/interceptors/json-serializer.interceptor";
import { LoggingInterceptor } from "@/shared/interceptors/logging.interceptor";
import { SharedModule } from "@/shared/shared.module";
import { SuppliersModule } from "@/suppliers/suppliers.module";
import { AuditContextInterceptor } from "./shared/prisma/audit-context.interceptor";

@Module({
  imports: [
    ConfigModule,
    SharedModule,
    DatabaseModule,
    LoggingModule,
    AuthModule,
    ClientsModule,
    ContactModule,
    ExtractionModule,
    FilesModule,
    InvitationModule,
    OrganizationModule,
    ProjectsModule,
    SuppliersModule,
    RealtimeModule
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheControlInterceptor
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: JsonSerializerInterceptor
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditContextInterceptor
    }
  ]
})
export class AppModule {}
