import { Module } from "@nestjs/common";
import { ConfigModule } from "@/config/config.module";
import { DatabaseModule } from "@/shared/database/database.module";
import { SharedModule } from "@/shared/shared.module";
import { SupplierEmailService } from "@/suppliers/supplier-email.service";
import { SupplierMatchingService } from "@/suppliers/supplier-matching.service";
import { SuppliersController } from "@/suppliers/suppliers.controller";
import { SuppliersService } from "@/suppliers/suppliers.service";

@Module({
  imports: [SharedModule, DatabaseModule, ConfigModule],
  controllers: [SuppliersController],
  providers: [SuppliersService, SupplierMatchingService, SupplierEmailService],
  exports: [SuppliersService, SupplierMatchingService, SupplierEmailService]
})
export class SuppliersModule {}
