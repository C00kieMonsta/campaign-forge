import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Request
} from "@nestjs/common";
import {
  AgentDefinition,
  CreateManualResultRequest,
  CreateManualResultRequestSchema,
  CreateSchemaRequest,
  CreateSchemaRequestSchema,
  ExtractionJob,
  ExtractionJobListResponse,
  ExtractionResult,
  ExtractionResultStatus,
  ExtractionSchema,
  StartExtractionJobRequest,
  StartExtractionJobRequestSchema,
  TABLE_NAMES,
  TestAgentRequest,
  TestAgentRequestSchema,
  TestAgentResponse,
  UpdateSchemaRequest,
  UpdateSchemaRequestSchema
} from "@packages/types";
import { Prisma } from "@prisma/client";
import { ExtractionResultService } from "@/extraction/services/extraction-result.service";
import { ExtractionSchemaService } from "@/extraction/services/extraction-schema.service";
import { ExtractionService } from "@/extraction/services/extraction.service";
import { PDFProcessingService } from "@/extraction/services/pdf-processing.service";
import { Audit } from "@/logger/audit.decorator";
import { SupplierMatchesDatabaseService } from "@/shared/database/services/supplier-matches.database.service";
import { AuthenticatedRequest } from "@/shared/types/request.types";
import {
  GenerateSupplierEmailsResponse,
  SupplierEmailService
} from "@/suppliers/supplier-email.service";
import { SupplierMatchingService } from "@/suppliers/supplier-matching.service";

@Controller("extraction")
export class ExtractionController {
  private readonly extractionTableName = TABLE_NAMES.EXTRACTION_JOBS;
  constructor(
    private extractionService: ExtractionService,
    private extractionResultService: ExtractionResultService,
    private schemaService: ExtractionSchemaService,
    private pdfProcessingService: PDFProcessingService,
    private supplierMatchingService: SupplierMatchingService,
    private supplierMatchesDb: SupplierMatchesDatabaseService,
    private supplierEmailService: SupplierEmailService
  ) {}

  @Post("job")
  @Audit({ action: "start", resource: "extraction_job" })
  async startExtraction(
    @Body() body: StartExtractionJobRequest,
    @Request() req: AuthenticatedRequest
  ): Promise<ExtractionJob> {
    const data: StartExtractionJobRequest =
      StartExtractionJobRequestSchema.parse(body);
    const user = req.user;
    if (!user) {
      throw new Error("User not found");
    }
    if (!user.organizationId) {
      throw new Error("User is not associated with any organization");
    }

    return this.extractionService.startExtractionJob(
      user.organizationId,
      user.id,
      data
    ) as Promise<ExtractionJob>;
  }

  @Get("job/:id")
  async getExtractionJob(
    @Param("id") jobId: string
  ): Promise<ExtractionJob | null> {
    return this.extractionService.getExtractionJobById(
      jobId
    ) as Promise<ExtractionJob | null>;
  }

  @Get("job/:id/logs")
  async getExtractionJobLogs(@Param("id") jobId: string): Promise<{
    logs: Array<{ timestamp: string; level: string; message: string }>;
  }> {
    const job = await this.extractionService.getExtractionJobById(jobId);
    if (!job) {
      throw new Error("Extraction job not found");
    }

    const logs = Array.isArray(job.logs) ? job.logs : [];
    return {
      logs: logs as Array<{ timestamp: string; level: string; message: string }>
    };
  }

  @Get("project/:projectId/jobs")
  async getProjectExtractionJobs(
    @Param("projectId") projectId: string
  ): Promise<ExtractionJobListResponse> {
    const extractionJobs =
      await this.extractionService.getExtractionJobsByProject(projectId);

    return {
      extractionJobs: extractionJobs,
      total: extractionJobs.length,
      page: 1,
      limit: extractionJobs.length
    };
  }

  @Get("job/:jobId/results")
  @Audit({ action: "get", resource: "extraction_results" })
  async getJobResults(@Param("jobId") jobId: string): Promise<{
    results: ExtractionResult[];
    schema: Record<string, unknown> | null;
  }> {
    const results: ExtractionResult[] =
      await this.extractionResultService.getResultsByJobId(jobId);

    // Get extraction job with schema information
    const job = await this.extractionService.getJobWithSchema(jobId);

    return {
      results,
      schema: job?.schema || null
    };
  }

  // apps/backend/src/extraction/extraction.controller.ts
  // Add this after the selectSupplier endpoint (around line 224)

  @Put("result/:resultId")
  @Audit({ action: "update_result", resource: "extraction_result" })
  async updateResult(
    @Param("resultId") resultId: string,
    @Body() body: Record<string, unknown>,
    @Request() req: AuthenticatedRequest
  ): Promise<ExtractionResult> {
    const user = req.user;
    if (!user) {
      throw new HttpException("User not found", HttpStatus.UNAUTHORIZED);
    }

    // Extract verifiedData from body.data (frontend repository sends it nested)
    const verifiedData = (body.data as Record<string, unknown>) || {};
    const status = body.status as ExtractionResultStatus | undefined;
    const verificationNotes = body.verificationNotes as string | undefined;

    // If there's verifiedData or status to update, call updateVerifiedData
    if (Object.keys(verifiedData).length > 0 || status) {
      return this.extractionResultService.updateVerifiedData(
        resultId,
        verifiedData,
        user.id,
        verificationNotes,
        status
      );
    }

    throw new BadRequestException("No valid update fields provided");
  }

  @Post("result/manual")
  @Audit({ action: "create_manual_result", resource: "extraction_result" })
  async createManualResult(
    @Body() body: CreateManualResultRequest,
    @Request() req: AuthenticatedRequest
  ): Promise<ExtractionResult> {
    const user = req.user;
    if (!user) {
      throw new HttpException("User not found", HttpStatus.UNAUTHORIZED);
    }

    const validatedData = CreateManualResultRequestSchema.parse(body);

    return this.extractionResultService.createManualResult(validatedData);
  }

  // Supplier Matching Endpoints
  @Post("job/:jobId/match-suppliers")
  @Audit({ action: "match_suppliers", resource: "extraction_job" })
  async matchSuppliers(
    @Param("jobId") jobId: string,
    @Request() req: AuthenticatedRequest
  ): Promise<Record<string, unknown>> {
    const user = req.user;
    if (!user) {
      throw new Error("User not found");
    }
    if (!user.organizationId) {
      throw new HttpException(
        "User is not associated with any organization",
        HttpStatus.FORBIDDEN
      );
    }

    return this.supplierMatchingService.matchExtractionResultsWithSuppliers(
      jobId,
      user.organizationId
    );
  }

  @Get("job/:jobId/supplier-matches")
  @Audit({ action: "get_supplier_matches", resource: "extraction_job" })
  async getJobSupplierMatches(
    @Param("jobId") jobId: string
  ): Promise<Record<string, unknown>> {
    const extractionResults =
      await this.supplierMatchesDb.getMatchesByJobId(jobId);
    return { extractionResults };
  }

  @Put("result/:resultId/select-supplier")
  @Audit({ action: "select_supplier", resource: "extraction_result" })
  async selectSupplier(
    @Param("resultId") resultId: string,
    @Body() body: { supplierId: string },
    @Request() req: AuthenticatedRequest
  ): Promise<{ success: boolean; match: Record<string, unknown> }> {
    const user = req.user;
    if (!user) {
      throw new Error("User not found");
    }

    // Validate input
    if (
      !body.supplierId ||
      typeof body.supplierId !== "string" ||
      body.supplierId.trim() === ""
    ) {
      throw new HttpException(
        "Invalid supplier ID: must be a non-empty string",
        HttpStatus.BAD_REQUEST
      );
    }

    if (!resultId || typeof resultId !== "string") {
      throw new HttpException(
        "Invalid extraction result ID",
        HttpStatus.BAD_REQUEST
      );
    }

    try {
      const match = await this.supplierMatchesDb.selectSupplier(
        resultId,
        body.supplierId,
        user.id
      );

      return { success: true, match };
    } catch (error) {
      if (error instanceof Error) {
        throw new HttpException(
          error.message,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
      throw new HttpException(
        "Failed to select supplier",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get("job/:jobId/generate-supplier-emails")
  @Audit({ action: "generate_supplier_emails", resource: "extraction_job" })
  async generateSupplierEmails(
    @Param("jobId") jobId: string
  ): Promise<GenerateSupplierEmailsResponse> {
    // Verify job exists
    const job = await this.extractionService.getExtractionJobById(jobId);
    if (!job) {
      throw new HttpException("Extraction job not found", HttpStatus.NOT_FOUND);
    }

    // Generate email text for all suppliers with selected matches
    const result =
      await this.supplierEmailService.generateSupplierEmailText(jobId);

    if (result.emails.length === 0) {
      throw new HttpException(
        "No suppliers selected. Please select suppliers before generating emails",
        HttpStatus.BAD_REQUEST
      );
    }

    return result;
  }

  // Schema Management Endpoints
  @Get("schemas")
  @Audit({ action: "list", resource: "extraction_schema" })
  async listSchemas(
    @Request() req: AuthenticatedRequest
  ): Promise<ExtractionSchema[]> {
    const user = req.user;

    if (!user) {
      throw new Error("User not found");
    }

    if (!user.organizationId) {
      throw new Error("User is not associated with any organization");
    }

    return this.schemaService.listSchemasForOrganization(user.organizationId);
  }

  @Get("schemas/:id")
  @Audit({ action: "get", resource: "extraction_schema" })
  async getSchema(
    @Param("id") schemaId: string
  ): Promise<Record<string, unknown>> {
    const schema = await this.schemaService.getSchemaById(schemaId);
    if (!schema) {
      throw new Error("Schema not found");
    }
    return schema;
  }

  @Post("schemas")
  @Audit({ action: "create", resource: "extraction_schema" })
  async createSchema(
    @Body() body: CreateSchemaRequest,
    @Request() req: AuthenticatedRequest
  ): Promise<Record<string, unknown>> {
    const user = req.user;

    if (user && !user.organizationId) {
      throw new Error("User is not associated with any organization");
    }

    // Validate request body using Zod schema
    let validatedData: CreateSchemaRequest;
    try {
      validatedData = CreateSchemaRequestSchema.parse(body);
    } catch (error) {
      // Return clear validation error messages
      if (
        error &&
        typeof error === "object" &&
        "errors" in error &&
        Array.isArray(error.errors)
      ) {
        const messages = error.errors
          .map((err: { path?: (string | number)[]; message?: string }) => {
            const path = err.path?.join(".") || "unknown";
            return `${path}: ${err.message || "validation error"}`;
          })
          .join(", ");
        throw new BadRequestException(`Validation failed: ${messages}`);
      }
      throw new BadRequestException("Invalid request body");
    }

    if (!user) {
      throw new Error("User not found");
    }

    if (!user.organizationId) {
      throw new Error("User is not associated with any organization");
    }

    try {
      return await this.schemaService.createSchema(
        user.organizationId,
        validatedData.name,
        validatedData.version,
        validatedData.definition as Prisma.InputJsonValue,
        validatedData.prompt,
        validatedData.examples as Prisma.InputJsonValue | null,
        validatedData.agents
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002"
      ) {
        throw new BadRequestException(
          "A schema with this name and version already exists in your organization. Please use a different name or update the existing schema."
        );
      }
      throw error;
    }
  }

  @Post("schemas/test-agent")
  @Audit({ action: "test_agent", resource: "extraction_schema" })
  async testAgent(@Body() body: TestAgentRequest): Promise<TestAgentResponse> {
    const validatedData = TestAgentRequestSchema.parse(body);

    try {
      return await this.schemaService.testAgent(
        validatedData.agent,
        validatedData.inputData
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(`Agent test failed: ${message}`);
    }
  }

  @Put("schemas/:id")
  @Audit({ action: "update", resource: "extraction_schema" })
  async updateSchema(
    @Param("id") schemaId: string,
    @Body() body: UpdateSchemaRequest
  ): Promise<ExtractionSchema> {
    const validatedData = UpdateSchemaRequestSchema.parse(body);
    return this.schemaService.updateSchema(schemaId, validatedData);
  }

  @Get("schemas/:id/job-count")
  @Audit({ action: "get_job_count", resource: "extraction_schema" })
  async getSchemaJobCount(
    @Param("id") schemaId: string
  ): Promise<{ count: number }> {
    try {
      const count = await this.schemaService.getSchemaJobCount(schemaId);
      return { count };
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get("schemas/identifier/:identifier/job-count")
  @Audit({
    action: "get_job_count_by_identifier",
    resource: "extraction_schema"
  })
  async getSchemaJobCountByIdentifier(
    @Param("identifier") identifier: string,
    @Request() req: AuthenticatedRequest
  ): Promise<{ count: number }> {
    try {
      const user = req.user;
      if (!user) {
        throw new Error("User not found");
      }
      if (!user.organizationId) {
        throw new Error("User is not associated with any organization");
      }
      const count = await this.schemaService.getSchemaJobCountByIdentifier(
        user.organizationId,
        identifier
      );
      return { count };
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Delete("schemas/:id")
  @Audit({ action: "delete", resource: "extraction_schema" })
  async deleteSchema(
    @Param("id") schemaId: string
  ): Promise<{ success: boolean; deletedJobsCount: number }> {
    try {
      const result = await this.schemaService.deleteSchema(schemaId);
      return { success: true, deletedJobsCount: result.deletedJobsCount };
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  // Version Management Endpoints
  @Get("schemas/identifier/:identifier/versions")
  @Audit({ action: "list_versions", resource: "extraction_schema" })
  async getSchemaVersions(
    @Param("identifier") identifier: string,
    @Request() req: AuthenticatedRequest
  ): Promise<ExtractionSchema[]> {
    const user = req.user;
    if (!user) {
      throw new Error("User not found");
    }
    if (!user.organizationId) {
      throw new Error("User is not associated with any organization");
    }
    return this.schemaService.listSchemaVersions(
      user.organizationId,
      identifier
    );
  }

  @Post("schemas/:id/versions")
  @Audit({ action: "create_version", resource: "extraction_schema" })
  async createSchemaVersion(
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      definition?: Record<string, unknown>;
      prompt?: string;
      examples?: Array<Record<string, unknown>>;
      agents?: AgentDefinition[];
      changeDescription?: string;
    }
  ): Promise<Record<string, unknown>> {
    return this.schemaService.createNewVersion(
      id,
      body as unknown as Record<string, unknown>
    );
  }

  @Delete("schemas/identifier/:identifier/all")
  @Audit({ action: "delete_all_versions", resource: "extraction_schema" })
  async deleteAllVersions(
    @Param("identifier") identifier: string,
    @Request() req: AuthenticatedRequest
  ): Promise<{ success: boolean; deletedJobsCount: number }> {
    const user = req.user;
    if (!user) {
      throw new Error("User not found");
    }
    if (!user.organizationId) {
      throw new Error("User is not associated with any organization");
    }
    const result = await this.schemaService.deleteAllVersions(
      user.organizationId,
      identifier
    );
    return { success: true, deletedJobsCount: result.deletedJobsCount };
  }
}
