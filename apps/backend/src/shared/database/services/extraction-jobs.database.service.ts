import { Injectable } from "@nestjs/common";
import {
  ASYNC_JOB_STATUSES,
  CreateExtractionJobData,
  EXTRACTION_JOB_INCLUDE_SHAPE,
  ExtractionJob,
  getSchemaSize,
  IExtractionJobRepository,
  isSchemaOversized,
  MAX_SCHEMA_SIZE_BYTES,
  optimizeSchemaWithSizeCheck
} from "@packages/types";
import { Prisma } from "@prisma/client";
import { ConfigService } from "@/config/config.service";
import { BaseDatabaseService } from "@/shared/database/base-database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

@Injectable()
export class ExtractionJobsDatabaseService
  extends BaseDatabaseService
  implements IExtractionJobRepository
{
  constructor(prismaService: PrismaService, configService: ConfigService) {
    super(prismaService, configService);
  }
  async createExtractionJob(
    data: CreateExtractionJobData
  ): Promise<ExtractionJob> {
    const dataLayerIds = this.getDataLayerIds(data);
    const isBatchJob = dataLayerIds.length > 1;

    this.logger.info(
      JSON.stringify({
        level: "info",
        action: "creatingExtractionJob",
        jobType: data.jobType,
        layerCount: dataLayerIds.length,
        isBatch: isBatchJob
      })
    );

    try {
      // Optimize schema using centralized utility (no NestJS dependencies)
      const optimizedSchema = optimizeSchemaWithSizeCheck(
        data.compiledJsonSchema || {}
      );

      const schemaSize = getSchemaSize(optimizedSchema);
      if (isSchemaOversized(optimizedSchema)) {
        this.logger.warn(
          JSON.stringify({
            level: "warn",
            action: "schemaOversized",
            originalSize: schemaSize,
            limit: MAX_SCHEMA_SIZE_BYTES
          })
        );
      }

      // Ensure the optimized schema is cast to Prisma.InputJsonValue to satisfy the Prisma type
      const extractionJob = await this.prisma.extractionJob.create({
        data: {
          organizationId: data.organizationId,
          initiatedBy: data.initiatedBy,
          jobType: data.jobType,
          config: data.config || {},
          schemaId: data.schemaId,
          compiledJsonSchema: optimizedSchema as Prisma.InputJsonValue,
          status: ASYNC_JOB_STATUSES.QUEUED,
          progressPercentage: 0,
          meta: {
            isBatchJob,
            totalPages: dataLayerIds.length,
            ...(data.config?.meta || {})
          },
          // Create the junction table entries for all data layers
          extractionJobDataLayers: {
            create: dataLayerIds.map((dataLayerId, index) => ({
              dataLayerId,
              processingOrder: index,
              status: "pending"
            }))
          }
        },
        include: EXTRACTION_JOB_INCLUDE_SHAPE
      });

      return extractionJob as ExtractionJob;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          level: "error",
          action: "failedToCreateExtractionJob",
          error: error instanceof Error ? error.message : String(error)
        })
      );
      throw new Error(
        `Failed to create extraction job: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Extract data layer IDs from the request data
   */
  private getDataLayerIds(data: CreateExtractionJobData): string[] {
    // Priority: explicit dataLayerIds > individual dataLayerId > fallback to empty array
    if (data.dataLayerIds && data.dataLayerIds.length > 0) {
      return data.dataLayerIds;
    }
    if (data.dataLayerId) {
      return [data.dataLayerId];
    }
    throw new Error("No data layer IDs provided for extraction job");
  }

  /**
   * Update the status of a specific data layer in an extraction job
   */
  async updateExtractionJobDataLayerStatus(
    jobId: string,
    dataLayerId: string,
    status: "pending" | "processing" | "completed" | "failed"
  ): Promise<void> {
    try {
      await this.prisma.extractionJobDataLayer.updateMany({
        where: {
          extractionJobId: jobId,
          dataLayerId: dataLayerId
        },
        data: {
          status: status
        }
      });
    } catch (error) {
      this.logger.error("Failed to update extraction job data layer status", {
        ...this.context,
        jobId,
        dataLayerId,
        status,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to update data layer status: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get all data layers for an extraction job
   */
  async getExtractionJobDataLayers(jobId: string) {
    try {
      return await this.prisma.extractionJobDataLayer.findMany({
        where: {
          extractionJobId: jobId
        },
        include: {
          dataLayer: {
            select: { id: true, name: true, fileType: true, filePath: true }
          }
        },
        orderBy: {
          processingOrder: "asc"
        }
      });
    } catch (error) {
      this.logger.error("Failed to get extraction job data layers", {
        ...this.context,
        jobId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to get job data layers: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Add a log entry to an extraction job
   */
  async appendJobLog(
    jobId: string,
    logEntry: {
      timestamp: string;
      level: "info" | "warn" | "error";
      message: string;
    }
  ): Promise<void> {
    try {
      const job = await this.prisma.extractionJob.findUnique({
        where: { id: jobId },
        select: { logs: true }
      });

      if (!job) {
        throw new Error("Job not found");
      }

      const currentLogs =
        (job.logs as Array<{
          timestamp: string;
          level: string;
          message: string;
        }>) || [];
      const updatedLogs = [...currentLogs, logEntry];

      await this.prisma.extractionJob.update({
        where: { id: jobId },
        data: { logs: updatedLogs }
      });
    } catch (error) {
      this.logger.error("Failed to append job log", {
        ...this.context,
        jobId,
        error: error instanceof Error ? error.message : String(error)
      });
      // Don't throw - logging failures shouldn't break the extraction process
    }
  }

  /**
   * Add a data layer to an existing extraction job
   */
  async addDataLayerToJob(
    jobId: string,
    dataLayerId: string,
    processingOrder: number = 0
  ): Promise<void> {
    try {
      await this.prisma.extractionJobDataLayer.create({
        data: {
          extractionJobId: jobId,
          dataLayerId,
          processingOrder,
          status: "pending"
        }
      });
    } catch (error) {
      this.logger.error("Failed to add data layer to job", {
        ...this.context,
        jobId,
        dataLayerId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to add data layer to job: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getExtractionJobById(jobId: string): Promise<ExtractionJob | null> {
    try {
      const extractionJob = await this.prisma.extractionJob.findUnique({
        where: { id: jobId },
        include: EXTRACTION_JOB_INCLUDE_SHAPE
      });

      return extractionJob ? (extractionJob as ExtractionJob) : null;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          level: "error",
          action: "failedToGetExtractionJob",
          jobId,
          error: error instanceof Error ? error.message : String(error)
        })
      );
      throw new Error(
        `Failed to get extraction job: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getExtractionJobsByProject(
    projectId: string
  ): Promise<ExtractionJob[]> {
    try {
      const extractionJobs = await this.prisma.extractionJob.findMany({
        where: {
          extractionJobDataLayers: {
            some: {
              dataLayer: {
                projectId: projectId
              }
            }
          }
        },
        include: EXTRACTION_JOB_INCLUDE_SHAPE,
        orderBy: { createdAt: "desc" }
      });

      return extractionJobs.map((job: unknown) => job as ExtractionJob);
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          level: "error",
          action: "failedToGetProjectExtractionJobs",
          projectId,
          error: error instanceof Error ? error.message : String(error)
        })
      );
      throw new Error(
        `Failed to get project extraction jobs: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getExtractionJobsByDataLayer(
    dataLayerId: string
  ): Promise<ExtractionJob[]> {
    try {
      const extractionJobs = await this.prisma.extractionJob.findMany({
        where: {
          extractionJobDataLayers: {
            some: {
              dataLayerId: dataLayerId
            }
          }
        },
        include: EXTRACTION_JOB_INCLUDE_SHAPE,
        orderBy: { createdAt: "desc" }
      });

      return extractionJobs.map((job: unknown) => job as ExtractionJob);
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          level: "error",
          action: "failedToGetDataLayerExtractionJobs",
          dataLayerId,
          error: error instanceof Error ? error.message : String(error)
        })
      );
      throw new Error(
        `Failed to get data layer extraction jobs: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async updateExtractionJobStatus(
    jobId: string,
    status: "queued" | "running" | "completed" | "failed" | "cancelled",
    progress?: number,
    errorMessage?: string,
    metadata?: unknown
  ): Promise<ExtractionJob> {
    // Map status to ASYNC_JOB_STATUSES for type safety
    const validStatuses: Record<string, string> = {
      queued: ASYNC_JOB_STATUSES.QUEUED,
      running: ASYNC_JOB_STATUSES.RUNNING,
      completed: ASYNC_JOB_STATUSES.COMPLETED,
      failed: ASYNC_JOB_STATUSES.FAILED,
      cancelled: ASYNC_JOB_STATUSES.CANCELLED
    };
    const normalizedStatus = validStatuses[status] || status;
    try {
      const updateData: Record<string, unknown> = { status: normalizedStatus };

      if (progress !== undefined) {
        updateData.progressPercentage = Math.max(0, Math.min(100, progress));
      }

      if (normalizedStatus === ASYNC_JOB_STATUSES.RUNNING) {
        updateData.startedAt = new Date();
      }

      if (
        normalizedStatus === ASYNC_JOB_STATUSES.COMPLETED ||
        normalizedStatus === ASYNC_JOB_STATUSES.FAILED
      ) {
        updateData.completedAt = new Date();
        if (normalizedStatus === ASYNC_JOB_STATUSES.COMPLETED) {
          updateData.progressPercentage = 100;
        }
      }

      if (errorMessage) {
        updateData.errorMessage = errorMessage;
      }

      if (metadata !== undefined) {
        // Merge workflow progress and summary in meta field (JSONB)
        // This preserves existing page-level progress while updating file-level progress
        // Get current job to merge existing meta
        const currentJob = await this.prisma.extractionJob.findUnique({
          where: { id: jobId },
          select: { meta: true }
        });

        const existingMeta = currentJob?.meta || {};
        const newMeta =
          typeof metadata === "object" && metadata !== null ? metadata : {};

        // Merge existing meta with new meta (new values override existing ones)
        // NEW values always take precedence over old values
        updateData.meta = {
          ...(typeof existingMeta === "object" && existingMeta !== null
            ? existingMeta
            : {}),
          ...(typeof newMeta === "object" ? newMeta : {})
        };

        this.logger.debug(
          JSON.stringify({
            level: "debug",
            action: "savingJobMeta",
            jobId,
            meta: updateData.meta
          })
        );
      }

      const extractionJob = await this.prisma.extractionJob.update({
        where: { id: jobId },
        data: updateData,
        include: EXTRACTION_JOB_INCLUDE_SHAPE
      });

      return extractionJob as ExtractionJob;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          level: "error",
          action: "failedToUpdateExtractionJobStatus",
          jobId,
          status,
          error: error instanceof Error ? error.message : String(error)
        })
      );
      throw new Error(
        `Failed to update extraction job status: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // JSONB-specific query methods
  async getExtractionJobsByConfidenceScore(
    minConfidence: number
  ): Promise<ExtractionJob[]> {
    try {
      const startTime = performance.now();

      const extractionJobs = await this.prisma.extractionJob.findMany({
        where: {
          status: "completed",
          extractionResults: {
            some: {
              confidenceScore: {
                gte: minConfidence
              }
            }
          }
        },
        include: EXTRACTION_JOB_INCLUDE_SHAPE,
        orderBy: { createdAt: "desc" }
      });

      const duration = performance.now() - startTime;
      this.logger.info(
        JSON.stringify({
          level: "info",
          action: "confidenceScoreQueryCompleted",
          duration: `${duration}ms`,
          resultCount: extractionJobs.length,
          minConfidence
        })
      );

      return extractionJobs as ExtractionJob[];
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          level: "error",
          action: "failedToGetJobsByConfidenceScore",
          minConfidence,
          error: error instanceof Error ? error.message : String(error)
        })
      );
      throw new Error(
        `Failed to get extraction jobs by confidence score: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getExtractionJobsByMaterialType(
    materialType: string
  ): Promise<ExtractionJob[]> {
    try {
      const startTime = performance.now();

      const extractionJobs = await this.prisma.extractionJob.findMany({
        where: {
          status: "completed",
          extractionResults: {
            some: {
              OR: [
                {
                  verifiedData: {
                    string_contains: materialType
                  }
                },
                {
                  rawExtraction: {
                    string_contains: materialType
                  }
                }
              ]
            }
          }
        },
        include: EXTRACTION_JOB_INCLUDE_SHAPE,
        orderBy: { createdAt: "desc" }
      });

      const duration = performance.now() - startTime;
      this.logger.info(
        JSON.stringify({
          level: "info",
          action: "materialTypeQueryCompleted",
          duration: `${duration}ms`,
          resultCount: extractionJobs.length,
          materialType
        })
      );

      return extractionJobs as ExtractionJob[];
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          level: "error",
          action: "failedToGetJobsByMaterialType",
          materialType,
          error: error instanceof Error ? error.message : String(error)
        })
      );
      throw new Error(
        `Failed to get extraction jobs by material type: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async searchExtractionResults(
    searchTerm: string,
    organizationId: string
  ): Promise<ExtractionJob[]> {
    try {
      const startTime = performance.now();

      const extractionJobs = await this.prisma.extractionJob.findMany({
        where: {
          organizationId,
          status: "completed",
          extractionResults: {
            some: {
              OR: [
                {
                  verifiedData: {
                    string_contains: searchTerm
                  }
                },
                {
                  rawExtraction: {
                    string_contains: searchTerm
                  }
                }
              ]
            }
          }
        },
        include: EXTRACTION_JOB_INCLUDE_SHAPE,
        orderBy: { createdAt: "desc" }
      });

      const duration = performance.now() - startTime;
      this.logger.info(
        JSON.stringify({
          level: "info",
          action: "searchQueryCompleted",
          duration: `${duration}ms`,
          resultCount: extractionJobs.length,
          searchTerm,
          organizationId
        })
      );

      return extractionJobs as ExtractionJob[];
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          level: "error",
          action: "failedToSearchExtractionResults",
          searchTerm,
          organizationId,
          error: error instanceof Error ? error.message : String(error)
        })
      );
      throw new Error(
        `Failed to search extraction results: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getHighConfidenceExtractions(
    organizationId: string,
    minConfidence: number = 0.8
  ): Promise<ExtractionJob[]> {
    try {
      const startTime = performance.now();

      const extractionJobs = await this.prisma.extractionJob.findMany({
        where: {
          organizationId,
          status: "completed",
          extractionResults: {
            some: {
              confidenceScore: {
                gte: minConfidence
              }
            }
          }
        },
        include: EXTRACTION_JOB_INCLUDE_SHAPE,
        orderBy: { createdAt: "desc" }
      });

      const duration = performance.now() - startTime;
      this.logger.info(
        JSON.stringify({
          level: "info",
          action: "highConfidenceQueryCompleted",
          duration: `${duration}ms`,
          resultCount: extractionJobs.length,
          minConfidence,
          organizationId
        })
      );

      return extractionJobs as ExtractionJob[];
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          level: "error",
          action: "failedToGetHighConfidenceExtractions",
          organizationId,
          minConfidence,
          error: error instanceof Error ? error.message : String(error)
        })
      );
      throw new Error(
        `Failed to get high confidence extractions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async deleteExtractionJob(jobId: string): Promise<void> {
    try {
      await this.prisma.extractionJob.delete({
        where: { id: jobId }
      });
    } catch (error) {
      this.logger.error("Failed to delete extraction job", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to delete extraction job: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
