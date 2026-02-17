import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import {
  CreateSupplierRequest,
  DeleteSupplierResponse,
  ImportSuppliersResponse,
  Supplier,
  SupplierListResponse,
  UpdateSupplierRequest
} from "@packages/types";
import { z } from "zod";
import { BlobStorageService } from "@/shared/blob-storage/blob-storage.service";
import { SuppliersDatabaseService } from "@/shared/database/services/suppliers.database.service";
import { LLMService } from "@/shared/llm/llm.service";

// Schema for CSV extraction - using nullable for optional fields to work with structured outputs
const SupplierCSVSchema = z.object({
  suppliers: z.array(
    z.object({
      name: z.string(),
      contactName: z.string().nullable().default(null),
      contactEmail: z.string().email(),
      contactPhone: z.string().nullable().default(null),
      address: z
        .object({
          street: z.string().nullable().default(null),
          city: z.string().nullable().default(null),
          state: z.string().nullable().default(null),
          zip: z.string().nullable().default(null),
          country: z.string().nullable().default(null)
        })
        .nullable()
        .default(null),
      materialsOffered: z.array(z.string()).default([])
    })
  )
});

type SupplierCSVExtraction = z.infer<typeof SupplierCSVSchema>;

@Injectable()
export class SuppliersService {
  constructor(
    private suppliersDb: SuppliersDatabaseService,
    private blobStorageService: BlobStorageService,
    private llmService: LLMService
  ) {}

  async generateImportUploadUrl(
    organizationId: string,
    fileName: string,
    contentType: string
  ): Promise<{ uploadUrl: string; s3Key: string }> {
    const timestamp = Date.now();
    const sanitizedName = fileName.replace(/\s+/g, "-");
    const s3Key = `suppliers/imports/${organizationId}/${timestamp}-${sanitizedName}`;

    const uploadUrl = await this.blobStorageService.generateUploadUrl(
      s3Key,
      "processing",
      { contentType, expiresIn: 900 }
    );

    return { uploadUrl, s3Key };
  }

  async createSupplier(
    organizationId: string,
    data: CreateSupplierRequest
  ): Promise<Supplier> {
    return this.suppliersDb.createSupplier({
      ...data,
      organizationId
    });
  }

  async getSupplierById(supplierId: string): Promise<Supplier | null> {
    return this.suppliersDb.getSupplierById(supplierId);
  }

  async getSuppliersByOrganization(
    organizationId: string
  ): Promise<Supplier[]> {
    return this.suppliersDb.getSuppliersByOrganization(organizationId);
  }

  async updateSupplier(
    supplierId: string,
    data: UpdateSupplierRequest
  ): Promise<Supplier> {
    return this.suppliersDb.updateSupplier(supplierId, data);
  }

  async deleteSupplier(supplierId: string): Promise<DeleteSupplierResponse> {
    return this.suppliersDb.deleteSupplier(supplierId);
  }

  async getSuppliersWithPagination(
    organizationId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<SupplierListResponse> {
    const { suppliers, total } =
      await this.suppliersDb.getSuppliersByOrganizationWithPagination(
        organizationId,
        page,
        limit
      );

    return {
      suppliers,
      total,
      page,
      limit
    };
  }

  async importSuppliersFromCSV(
    organizationId: string,
    fileKey: string
  ): Promise<ImportSuppliersResponse> {
    try {
      console.log(
        `[ImportCSV] Starting import for org: ${organizationId}, fileKey: ${fileKey}`
      );

      // Download CSV file from S3
      console.log(`[ImportCSV] Downloading file from S3...`);
      const csvContent = await this.blobStorageService.getFileAsString(
        fileKey,
        "processing"
      );
      console.log(
        `[ImportCSV] File downloaded, length: ${csvContent.length} chars`
      );

      // Extract supplier data using LLM
      console.log(`[ImportCSV] Extracting suppliers using LLM...`);
      const extractedData = await this.extractSuppliersFromCSV(csvContent);

      // Validate extraction result
      if (
        !extractedData ||
        !extractedData.suppliers ||
        !Array.isArray(extractedData.suppliers)
      ) {
        console.error(
          `[ImportCSV] Invalid extraction result: ${JSON.stringify(extractedData)}`
        );
        throw new HttpException(
          "Failed to extract suppliers from CSV. The file may be malformed or the content could not be parsed.",
          HttpStatus.BAD_REQUEST
        );
      }

      console.log(
        `[ImportCSV] Extracted ${extractedData.suppliers.length} suppliers`
      );

      // Create suppliers in database
      const createdSuppliers: Supplier[] = [];
      for (const supplierData of extractedData.suppliers) {
        try {
          const normalizedAddress =
            supplierData.address && typeof supplierData.address === "object"
              ? Object.entries(supplierData.address).reduce(
                  (acc, [key, value]) => {
                    if (typeof value === "string" && value.trim().length > 0) {
                      acc[
                        key as keyof NonNullable<
                          CreateSupplierRequest["address"]
                        >
                      ] = value.trim();
                    }
                    return acc;
                  },
                  {} as NonNullable<CreateSupplierRequest["address"]>
                )
              : undefined;

          const address =
            normalizedAddress && Object.keys(normalizedAddress).length > 0
              ? normalizedAddress
              : undefined;

          const materials =
            Array.isArray(supplierData.materialsOffered) &&
            supplierData.materialsOffered.length > 0
              ? supplierData.materialsOffered.filter(
                  (material): material is string =>
                    typeof material === "string" && material.trim().length > 0
                )
              : [];

          const supplier = await this.suppliersDb.createSupplier({
            organizationId,
            name: supplierData.name,
            contactName: supplierData.contactName ?? undefined,
            contactEmail: supplierData.contactEmail,
            contactPhone: supplierData.contactPhone ?? undefined,
            address,
            materialsOffered: materials
          });
          createdSuppliers.push(supplier);
        } catch (error) {
          // Skip duplicates and continue
          console.warn(
            `Failed to create supplier ${supplierData.name}:`,
            error
          );
        }
      }

      // Generate a mock extraction job ID for consistency with the API
      const extractionJobId = `csv-import-${Date.now()}`;

      return {
        suppliers: createdSuppliers,
        extractionJobId
      };
    } catch (error) {
      if (error instanceof HttpException) {
        console.error("[ImportCSV] HttpException:", error.message);
        throw error;
      }

      console.error("[ImportCSV] Import error:", error);
      console.error(
        "[ImportCSV] Error stack:",
        error instanceof Error ? error.stack : "No stack"
      );
      throw new HttpException(
        `Failed to import suppliers from CSV: ${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private async extractSuppliersFromCSV(
    csvContent: string
  ): Promise<SupplierCSVExtraction> {
    const systemPrompt = `You are a data extraction assistant. Extract supplier information from the provided CSV content.
Parse the CSV and identify the following fields for each supplier:
- name (required)
- contactName (optional)
- contactEmail (required, must be valid email)
- contactPhone (optional)
- address (optional, with street, city, state, zip, country)
- materialsOffered (optional, array of materials/products the supplier offers)

Return the data in the specified JSON schema format.`;

    const userPrompt = `Extract supplier information from this CSV content:\n\n${csvContent}`;

    try {
      const result = await this.llmService.ask({
        systemPrompt,
        userPrompt,
        schema: SupplierCSVSchema as z.ZodSchema<SupplierCSVExtraction>,
        criticality: "high"
      });

      if (typeof result === "string") {
        throw new HttpException(
          "Invalid CSV format. Please ensure the file contains supplier information",
          HttpStatus.BAD_REQUEST
        );
      }

      return result;
    } catch {
      throw new HttpException(
        "Failed to extract suppliers from CSV. Please try again",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
