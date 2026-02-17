import { Injectable } from "@nestjs/common";
import { ExtractionResult } from "@packages/types";
import { ConfigService } from "@/config/config.service";
import { BaseDatabaseService } from "@/shared/database/base-database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

interface CreateMatchData {
  supplierId: string;
  confidenceScore: number;
  matchReason: string;
}

@Injectable()
export class SupplierMatchesDatabaseService extends BaseDatabaseService {
  constructor(prismaService: PrismaService, configService: ConfigService) {
    super(prismaService, configService);
  }

  /**
   * Creates supplier matches for an extraction result.
   * Deletes existing matches before creating new ones.
   */
  async createMatches(
    extractionResultId: string,
    matches: CreateMatchData[]
  ): Promise<void> {
    this.logger.info("Creating supplier matches", {
      ...this.context,
      extractionResultId,
      matchCount: matches.length
    });

    try {
      // Delete existing matches for this extraction result
      await this.prisma.supplierMatch.deleteMany({
        where: { extractionResultId }
      });

      // Create new matches
      await this.prisma.supplierMatch.createMany({
        data: matches.map((match) => ({
          extractionResultId,
          supplierId: match.supplierId,
          confidenceScore: match.confidenceScore,
          matchReason: match.matchReason
        }))
      });

      this.logger.info("Successfully created supplier matches", {
        ...this.context,
        extractionResultId,
        matchCount: matches.length
      });
    } catch (error) {
      this.logger.error("Failed to create supplier matches", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        extractionResultId
      });

      throw new Error(
        `Failed to create supplier matches: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Gets all supplier matches for an extraction job.
   * Returns extraction results grouped with their matches.
   *
   * Optimized query: Only selects necessary supplier fields to reduce payload
   */
  async getMatchesByJobId(jobId: string) {
    this.logger.debug("Fetching supplier matches for job", {
      ...this.context,
      jobId
    });

    try {
      // Get all extraction results for the job with their matches
      const results = await this.prisma.extractionResult.findMany({
        where: {
          extractionJobId: jobId
        },
        include: {
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
              confidenceScore: "desc"
            }
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      });

      // Transform to the expected format
      type SupplierMatchWithRelations = {
        id: string;
        extractionResultId: string;
        supplierId: string;
        supplier: unknown;
        confidenceScore: number | null;
        matchReason: unknown;
        isSelected: boolean;
        selectedBy: string | null;
        selectedAt: Date | null;
        emailSent: boolean;
        emailSentAt: Date | null;
        matchMetadata: unknown;
        meta: unknown;
        createdAt: Date;
        updatedAt: Date;
      };

      type ExtractionResultWithMatches = {
        id: string;
        verifiedData: unknown;
        rawExtraction: unknown;
        status: string;
        supplierMatches: SupplierMatchWithRelations[];
      };

      return results.map((result: ExtractionResultWithMatches) => ({
        id: result.id,
        data: result.verifiedData || result.rawExtraction,
        status: result.status,
        matches: result.supplierMatches.map(
          (match: SupplierMatchWithRelations) => ({
            id: match.id,
            extractionResultId: match.extractionResultId,
            supplierId: match.supplierId,
            supplier: match.supplier,
            confidenceScore: match.confidenceScore,
            matchReason: match.matchReason,
            isSelected: match.isSelected
          })
        )
      }));
    } catch (error) {
      this.logger.error("Failed to fetch supplier matches", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        jobId
      });

      throw new Error(
        `Failed to fetch supplier matches: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Selects a supplier for an extraction result.
   * Unselects all other suppliers for the same result.
   */
  async selectSupplier(
    extractionResultId: string,
    supplierId: string,
    userId: string
  ) {
    this.logger.info("Selecting supplier for extraction result", {
      ...this.context,
      extractionResultId,
      supplierId,
      userId
    });

    try {
      // First, unselect all matches for this extraction result
      await this.prisma.supplierMatch.updateMany({
        where: { extractionResultId },
        data: {
          isSelected: false,
          selectedBy: null,
          selectedAt: null
        }
      });

      // Then, select the specified supplier
      const match = await this.prisma.supplierMatch.update({
        where: {
          extractionResultId_supplierId: {
            extractionResultId,
            supplierId
          }
        },
        data: {
          isSelected: true,
          selectedBy: userId,
          selectedAt: new Date()
        },
        include: {
          supplier: true
        }
      });

      this.logger.info("Successfully selected supplier", {
        ...this.context,
        extractionResultId,
        supplierId
      });

      return match;
    } catch (error) {
      this.logger.error("Failed to select supplier", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        extractionResultId,
        supplierId
      });

      throw new Error(
        `Failed to select supplier: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Gets approved extraction results for a job.
   * Approved means: accepted or edited (not pending or rejected)
   */
  async getApprovedResultsByJobId(jobId: string): Promise<ExtractionResult[]> {
    this.logger.info("Fetching approved extraction results for job", {
      ...this.context,
      jobId
    });

    try {
      const results = await this.prisma.extractionResult.findMany({
        where: {
          extractionJobId: jobId,
          status: {
            in: ["accepted", "edited"]
          }
        },
        orderBy: { createdAt: "asc" }
      });

      return results.map(result => ({
        ...result,
        evidence: result.evidence as { sourceText: string | null; pageNumber: number | null; location: string | null }
      })) as ExtractionResult[];
    } catch (error) {
      this.logger.error("Failed to fetch approved extraction results", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        jobId
      });

      throw new Error(
        `Failed to fetch approved extraction results: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
