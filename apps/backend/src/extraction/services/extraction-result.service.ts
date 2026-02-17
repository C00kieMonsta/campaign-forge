import { Injectable, Logger } from "@nestjs/common";
import {
  CreateManualResultRequest,
  ExtractionResult,
  ExtractionResultStatus
} from "@packages/types";
import { Prisma } from "@prisma/client";
import { ExtractionSchemaService } from "@/extraction/services/extraction-schema.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

@Injectable()
export class ExtractionResultService {
  private logger = new Logger(ExtractionResultService.name);

  constructor(
    private prisma: PrismaService,
    private schemaService: ExtractionSchemaService
  ) {}

  async getResultsByJobId(jobId: string): Promise<ExtractionResult[]> {
    const results = await this.prisma.client.extractionResult.findMany({
      where: { extractionJobId: jobId },
      orderBy: [{ pageNumber: "asc" }, { id: "asc" }],
      include: {
        editor: {
          select: { id: true, firstName: true, lastName: true }
        },
        verifier: {
          select: { id: true, firstName: true, lastName: true }
        },
        supplierMatches: {
          include: {
            supplier: {
              select: {
                id: true,
                name: true,
                contactName: true,
                contactEmail: true,
                contactPhone: true,
                materialsOffered: true
              }
            }
          },
          orderBy: {
            createdAt: "desc"
          }
        }
      }
    });

    return results.map(result => ({
      ...result,
      evidence: result.evidence as { sourceText: string | null; pageNumber: number | null; location: string | null }
    })) as ExtractionResult[];
  }

  /**
   * Update verified data (human-in-the-loop correction)
   * This preserves the original rawExtraction and evidence
   * Merges updates with existing verifiedData instead of replacing it
   */
  async updateVerifiedData(
    resultId: string,
    verifiedData: Record<string, unknown>,
    userId: string,
    verificationNotes?: string,
    status?: ExtractionResultStatus
  ): Promise<ExtractionResult> {
    // Get current result to preserve existing verifiedData and status
    const currentResult = await this.prisma.client.extractionResult.findUnique({
      where: { id: resultId },
      select: {
        status: true,
        verifiedData: true,
        rawExtraction: true
      }
    });

    if (!currentResult) {
      throw new Error(`Extraction result ${resultId} not found`);
    }

    // ✅ Merge with existing verifiedData instead of replacing it
    // This ensures we only update the fields being changed, not overwriting everything
    const existingVerifiedData =
      (currentResult.verifiedData as Record<string, unknown>) || {};
    const mergedVerifiedData = {
      ...existingVerifiedData,
      ...verifiedData
    };

    // Validate the merged verified data
    const validation = this.schemaService.validateResult(mergedVerifiedData);
    if (!validation.success) {
      this.logger.warn(
        `Validation warnings for verified data:`,
        validation.errors
      );
    }

    const finalVerifiedData:
      | Prisma.InputJsonValue
      | Prisma.NullableJsonNullValueInput = validation.success
      ? (validation.data as unknown as Prisma.InputJsonValue)
      : (mergedVerifiedData as unknown as Prisma.InputJsonValue);

    const result = await this.prisma.client.extractionResult.update({
      where: { id: resultId },
      data: {
        verifiedData: finalVerifiedData,
        verifiedBy: userId,
        verifiedAt: new Date(),
        verificationNotes: verificationNotes,
        status: status || currentResult.status || "edited",
        editedBy: userId,
        editedAt: new Date()
      }
    });

    return {
      ...result,
      evidence: result.evidence as { sourceText: string | null; pageNumber: number | null; location: string | null }
    } as ExtractionResult;
  }

  /**
   * Create results with evidence tracking and schema validation
   */
  async createResultsWithEvidence(
    jobId: string,
    results: Array<Record<string, unknown>>
  ) {
    const extractionResults = results.map((result) => {
      // Create simple evidence object
      const evidence: Record<string, unknown> = {
        pageNumber: result.pageNumber,
        location: result.location || result.locationInDocument,
        sourceText: result.sourceText || result.originalSnippet
      };

      // Validate the extraction result (optional warning)
      const validation = this.schemaService.validateResult(result);
      if (!validation.success) {
        this.logger.warn(
          `Schema validation warning for result:`,
          validation.errors
        );
      }

      // Validate evidence (optional warning)
      const evidenceValidation = this.schemaService.validateEvidence(evidence);
      if (!evidenceValidation.success) {
        this.logger.warn(
          `Evidence validation warning:`,
          evidenceValidation.errors
        );
      }

      const status: ExtractionResultStatus =
        (result.status as ExtractionResultStatus) || "pending";
      const confidenceScore: number | null =
        typeof result.confidenceScore === "number"
          ? result.confidenceScore
          : null;
      const pageNumber: number | null =
        typeof result.pageNumber === "number" ? result.pageNumber : null;

      // Extract agent execution metadata if present
      const agentExecutionMetadata = result.agentExecutionMetadata || [];

      return {
        extractionJobId: jobId,
        rawExtraction: (validation.success
          ? (validation.data as unknown as Prisma.InputJsonValue)
          : (result as unknown as Prisma.InputJsonValue)) as Prisma.InputJsonValue,
        evidence: (evidenceValidation.success
          ? (evidenceValidation.data as unknown as Prisma.InputJsonValue)
          : (evidence as unknown as Prisma.InputJsonValue)) as Prisma.InputJsonValue,
        verifiedData: undefined, // No verified data initially
        agentExecutionMetadata: agentExecutionMetadata as Prisma.InputJsonValue,
        confidenceScore,
        pageNumber,
        // Note: locationInDocument is stored in evidence object, not in rawExtraction
        status
      };
    });

    return this.prisma.client.extractionResult.createMany({
      data: extractionResults as unknown as Prisma.ExtractionResultCreateManyInput[]
    });
  }

  /**
   * Create a manual extraction result (user-created entry)
   */
  async createManualResult(
    data: CreateManualResultRequest
  ): Promise<ExtractionResult> {
    const evidence: Record<string, unknown> = {
      pageNumber: data.pageNumber,
      location: data.locationInDoc,
      sourceText: data.originalSnippet
    };

    const validation = this.schemaService.validateResult(data.data);
    if (!validation.success) {
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "createManualResult",
          message: "Schema validation warning for manual result",
          errors: validation.errors
        })
      );
    }

    const evidenceValidation = this.schemaService.validateEvidence(evidence);
    if (!evidenceValidation.success) {
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "createManualResult",
          message: "Evidence validation warning",
          errors: evidenceValidation.errors
        })
      );
    }

    const result = await this.prisma.client.extractionResult.create({
      data: {
        extractionJobId: data.jobId,
        rawExtraction: (validation.success
          ? (validation.data as unknown as Prisma.InputJsonValue)
          : (data.data as unknown as Prisma.InputJsonValue)) as Prisma.InputJsonValue,
        evidence: (evidenceValidation.success
          ? (evidenceValidation.data as unknown as Prisma.InputJsonValue)
          : (evidence as unknown as Prisma.InputJsonValue)) as Prisma.InputJsonValue,
        verifiedData: undefined,
        status: "accepted",
        pageNumber: data.pageNumber || null,
        confidenceScore: null,
        verificationNotes: data.notes || "Manually created entry"
      },
      include: {
        editor: {
          select: { id: true, firstName: true, lastName: true }
        },
        verifier: {
          select: { id: true, firstName: true, lastName: true }
        },
        supplierMatches: {
          include: {
            supplier: {
              select: {
                id: true,
                name: true,
                contactName: true,
                contactEmail: true,
                contactPhone: true,
                materialsOffered: true
              }
            }
          },
          orderBy: {
            createdAt: "desc"
          }
        }
      }
    });

    return {
      ...result,
      evidence: result.evidence as { sourceText: string | null; pageNumber: number | null; location: string | null }
    } as ExtractionResult;
  }

  /**
   * Delete multiple extraction results (bulk delete)
   */
  async deleteExtractionResults(resultIds: string[]): Promise<number> {
    const result = await this.prisma.client.extractionResult.deleteMany({
      where: {
        id: {
          in: resultIds
        }
      }
    });

    this.logger.log(
      JSON.stringify({
        level: "info",
        action: "bulkDeleteExtractionResults",
        deletedCount: result.count,
        resultIds
      })
    );

    return result.count;
  }
}
