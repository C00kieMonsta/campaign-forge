import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Request
} from "@nestjs/common";
import {
  AuthenticatedUser,
  CreateSupplierRequest,
  CreateSupplierRequestSchema,
  DeleteSupplierResponse,
  ImportSuppliersRequest,
  ImportSuppliersRequestSchema,
  ImportSuppliersResponse,
  Supplier,
  SupplierListResponse,
  TABLE_NAMES,
  UpdateSupplierRequest,
  UpdateSupplierRequestSchema
} from "@packages/types";
import { z } from "zod";
import { Audit } from "@/logger/audit.decorator";
import { SuppliersService } from "@/suppliers/suppliers.service";
import { AuthenticatedRequest } from "@/shared/types/request.types";

@Controller(TABLE_NAMES.SUPPLIERS)
export class SuppliersController {
  constructor(private suppliersService: SuppliersService) {}

  @Post()
  @Audit({ action: "create", resource: "supplier" })
  async createSupplier(
    @Body() body: CreateSupplierRequest,
    @Request() req: AuthenticatedRequest
  ): Promise<Supplier> {
    try {
      const data = CreateSupplierRequestSchema.parse(body);
      const user = req.user;

      if (!user) {
        throw new HttpException(
          "Authentication required",
          HttpStatus.UNAUTHORIZED
        );
      }

      if (!user.organizationId) {
        throw new HttpException(
          "User is not associated with any organization. Please contact your administrator.",
          HttpStatus.FORBIDDEN
        );
      }

      return await this.suppliersService.createSupplier(
        user.organizationId,
        data
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error("Failed to create supplier:", error);
      throw new HttpException(
        "Failed to create supplier",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get()
  async getSuppliers(
    @Query("page") page: string = "1",
    @Query("limit") limit: string = "10",
    @Request() req: AuthenticatedRequest
  ): Promise<SupplierListResponse> {
    const user = req.user;

    if (!user?.organizationId) {
      throw new HttpException(
        "User is not associated with any organization",
        HttpStatus.FORBIDDEN
      );
    }

    const organizationId = user.organizationId;

    const result = await this.suppliersService.getSuppliersWithPagination(
      organizationId,
      parseInt(page),
      parseInt(limit)
    );

    return result;
  }

  @Get(":id")
  async getSupplier(
    @Param("id") supplierId: string,
    @Request() req: AuthenticatedRequest
  ): Promise<Supplier | null> {
    const user = req.user;

    if (!user) {
      throw new HttpException(
        "Authentication required",
        HttpStatus.UNAUTHORIZED
      );
    }

    return this.suppliersService.getSupplierById(supplierId);
  }

  @Put(":id")
  @Audit({ action: "update", resource: "supplier" })
  async updateSupplier(
    @Param("id") supplierId: string,
    @Body() body: UpdateSupplierRequest
  ): Promise<Supplier> {
    const data = UpdateSupplierRequestSchema.parse(body);
    return this.suppliersService.updateSupplier(supplierId, data);
  }

  @Delete(":id")
  @Audit({ action: "delete", resource: "supplier" })
  async deleteSupplier(
    @Param("id") supplierId: string
  ): Promise<DeleteSupplierResponse> {
    return this.suppliersService.deleteSupplier(supplierId);
  }

  @Post("import-csv")
  @Audit({ action: "import", resource: "supplier" })
  async importSuppliersFromCSV(
    @Body() body: ImportSuppliersRequest,
    @Request() req: AuthenticatedRequest
  ): Promise<ImportSuppliersResponse> {
    try {
      console.log(
        "[ImportCSV Controller] Received request body:",
        JSON.stringify(body)
      );
      const data = ImportSuppliersRequestSchema.parse(body);
      console.log("[ImportCSV Controller] Parsed data:", data);

      const user = req.user;

      if (!user) {
        throw new HttpException(
          "Authentication required",
          HttpStatus.UNAUTHORIZED
        );
      }

      if (!user.organizationId) {
        throw new HttpException(
          "User is not associated with any organization. Please contact your administrator.",
          HttpStatus.FORBIDDEN
        );
      }

      console.log(
        "[ImportCSV Controller] Calling service with fileId:",
        data.fileId
      );
      return await this.suppliersService.importSuppliersFromCSV(
        user.organizationId,
        data.fileId
      );
    } catch (error) {
      if (error instanceof HttpException) {
        console.error("[ImportCSV Controller] HttpException:", error.message);
        throw error;
      }

      console.error("[ImportCSV Controller] Error:", error);
      console.error(
        "[ImportCSV Controller] Error type:",
        error?.constructor?.name
      );
      console.error(
        "[ImportCSV Controller] Error message:",
        error instanceof Error ? error.message : String(error)
      );
      throw new HttpException(
        "Failed to import suppliers from CSV",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post("import-csv/upload-url")
  async generateImportUploadUrl(
    @Body() body: { fileName: string; contentType?: string },
    @Request() req: AuthenticatedRequest
  ): Promise<{ uploadUrl: string; s3Key: string }> {
    const user = req.user;
    if (!user?.organizationId) {
      throw new HttpException(
        "User is not associated with any organization",
        HttpStatus.FORBIDDEN
      );
    }

    return this.suppliersService.generateImportUploadUrl(
      user.organizationId,
      body.fileName,
      body.contentType || "text/csv"
    );
  }
}
