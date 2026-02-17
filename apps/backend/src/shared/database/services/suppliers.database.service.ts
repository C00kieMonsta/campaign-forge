import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import {
  CreateSupplierData,
  DeleteSupplierResponse,
  ISupplierRepository,
  Supplier,
  UpdateSupplierRequest
} from "@packages/types";
import { ConfigService } from "@/config/config.service";
import { BaseDatabaseService } from "@/shared/database/base-database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

@Injectable()
export class SuppliersDatabaseService
  extends BaseDatabaseService
  implements ISupplierRepository
{
  constructor(prismaService: PrismaService, configService: ConfigService) {
    super(prismaService, configService);
  }

  async createSupplier(data: CreateSupplierData): Promise<Supplier> {
    this.logger.info("Creating new supplier", {
      ...this.context,
      supplierName: data.name,
      organizationId: data.organizationId
    });

    try {
      // Check for duplicate email within organization
      const existingSupplier = await this.prisma.supplier.findFirst({
        where: {
          organizationId: data.organizationId,
          contactEmail: data.contactEmail
        }
      });

      if (existingSupplier) {
        throw new HttpException(
          "A supplier with this email already exists",
          HttpStatus.CONFLICT
        );
      }

      const supplier = await this.prisma.supplier.create({
        data: {
          organizationId: data.organizationId,
          name: data.name,
          contactName: data.contactName,
          contactEmail: data.contactEmail,
          contactPhone: data.contactPhone,
          address: data.address,
          materialsOffered: data.materialsOffered || []
        }
      });

      return supplier;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error("Failed to create supplier", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        organizationId: data.organizationId,
        supplierName: data.name
      });

      throw new Error(
        `Failed to create supplier: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getSuppliersByOrganization(
    organizationId: string
  ): Promise<Supplier[]> {
    this.logger.debug(
      `Fetching suppliers for organization ID: ${organizationId}`,
      this.context
    );

    try {
      const suppliers = await this.prisma.supplier.findMany({
        where: { organizationId },
        orderBy: { name: "asc" }
      });

      return suppliers;
    } catch (error) {
      this.logger.error("Failed to fetch suppliers", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to fetch suppliers: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getSuppliersByOrganizationWithPagination(
    organizationId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{ suppliers: Supplier[]; total: number }> {
    this.logger.debug(
      `Fetching suppliers for organization ID: ${organizationId} (page: ${page}, limit: ${limit})`,
      this.context
    );

    try {
      const skip = (page - 1) * limit;

      const [suppliers, total] = await Promise.all([
        this.prisma.supplier.findMany({
          where: { organizationId },
          orderBy: { name: "asc" },
          skip,
          take: limit
        }),
        this.prisma.supplier.count({
          where: { organizationId }
        })
      ]);

      return { suppliers, total };
    } catch (error) {
      this.logger.error("Failed to fetch suppliers with pagination", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to fetch suppliers with pagination: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getSupplierById(supplierId: string): Promise<Supplier | null> {
    try {
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: supplierId }
      });

      if (!supplier) {
        throw new HttpException("Supplier not found", HttpStatus.NOT_FOUND);
      }

      return supplier;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new Error(
        `Failed to get supplier: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async updateSupplier(
    supplierId: string,
    updates: UpdateSupplierRequest
  ): Promise<Supplier> {
    try {
      // Check if supplier exists
      const existingSupplier = await this.prisma.supplier.findUnique({
        where: { id: supplierId }
      });

      if (!existingSupplier) {
        throw new HttpException("Supplier not found", HttpStatus.NOT_FOUND);
      }

      // If email is being updated, check for duplicates
      if (
        updates.contactEmail &&
        updates.contactEmail !== existingSupplier.contactEmail
      ) {
        const duplicateSupplier = await this.prisma.supplier.findFirst({
          where: {
            organizationId: existingSupplier.organizationId,
            contactEmail: updates.contactEmail,
            id: { not: supplierId }
          }
        });

        if (duplicateSupplier) {
          throw new HttpException(
            "A supplier with this email already exists",
            HttpStatus.CONFLICT
          );
        }
      }

      const supplier = await this.prisma.supplier.update({
        where: { id: supplierId },
        data: {
          name: updates.name,
          contactName: updates.contactName,
          contactEmail: updates.contactEmail,
          contactPhone: updates.contactPhone,
          address: updates.address,
          materialsOffered: updates.materialsOffered
        }
      });

      return supplier;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new Error(
        `Failed to update supplier: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async deleteSupplier(supplierId: string): Promise<DeleteSupplierResponse> {
    try {
      // Check if supplier exists
      const existingSupplier = await this.prisma.supplier.findUnique({
        where: { id: supplierId },
        include: {
          matches: true
        }
      });

      if (!existingSupplier) {
        throw new HttpException("Supplier not found", HttpStatus.NOT_FOUND);
      }

      const deletedMatchesCount = existingSupplier.matches.length;

      // Delete supplier (cascade will handle matches)
      await this.prisma.supplier.delete({
        where: { id: supplierId }
      });

      return {
        success: true,
        deletedMatchesCount
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new Error(
        `Failed to delete supplier: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
