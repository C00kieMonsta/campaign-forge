import { Injectable, Logger } from "@nestjs/common";
import { ExtractionService } from "@/extraction/services/extraction.service";
import { ASYNC_JOB_STATUSES } from "@/shared/database/constants";
import { DataLayersDatabaseService } from "@/shared/database/services/data-layers.database.service";
import { ExtractionJobsDatabaseService } from "@/shared/database/services/extraction-jobs.database.service";
import {
  getErrorMessage,
  WorkflowProgress
} from "@/shared/utils/extraction-workflow.utils";

// Export the interface from utils to avoid duplication
export type { WorkflowProgress } from "@/shared/utils/extraction-workflow.utils";

@Injectable()
export class ExtractionWorkflowService {
  private logger = new Logger(ExtractionWorkflowService.name);

  constructor(
    private extractionJobsDb: ExtractionJobsDatabaseService,
    private dataLayersDb: DataLayersDatabaseService,
    private extractionService: ExtractionService
  ) {}

  /**
   * Complete workflow: Upload → Unzip → Extract → Track Progress
   */
  async processFileUpload(
    dataLayerId: string,
    organizationId: string,
    userId: string,
    schemaId: string
  ): Promise<void> {
    try {
      this.logger.log(
        `Starting complete workflow for data layer: ${dataLayerId}`
      );

      // Get data layer info
      const dataLayer = await this.dataLayersDb.getDataLayerById(dataLayerId);
      if (!dataLayer) {
        throw new Error("Data layer not found");
      }

      if (dataLayer.fileType === "zip") {
        await this.processZipWorkflow(
          dataLayerId,
          organizationId,
          userId,
          schemaId
        );
      } else {
        await this.processSingleFileWorkflow(
          dataLayerId,
          organizationId,
          userId,
          schemaId
        );
      }
    } catch (error) {
      this.logger.error(
        `Workflow failed for data layer ${dataLayerId}: ${getErrorMessage(error)}`,
        error
      );
      throw error;
    }
  }

  /**
   * Process zip file workflow: Create single job for ZIP and all extracted files
   */
  private async processZipWorkflow(
    dataLayerId: string,
    organizationId: string,
    userId: string,
    schemaId: string
  ): Promise<void> {
    // Create extraction job for the ZIP using specified schema
    const job = await this.extractionJobsDb.createExtractionJob({
      organizationId,
      dataLayerIds: [dataLayerId], // Use new array format
      initiatedBy: userId,
      jobType: "material_extraction",
      schemaId,
      config: { isZipWorkflow: true }
    });

    try {
      // Start extraction using the new unified approach
      // The extraction service now handles ZIP files properly within a single job
      this.extractionService.processExtractionJobInBackground(job.id);
    } catch (error) {
      await this.updateJobProgress(job.id, {
        stage: "failed",
        progress: 0,
        message: `Workflow failed: ${getErrorMessage(error)}`
      });
      throw error;
    }
  }

  /**
   * Process single file workflow: Direct extraction
   */
  private async processSingleFileWorkflow(
    dataLayerId: string,
    organizationId: string,
    userId: string,
    schemaId: string
  ): Promise<void> {
    // Create extraction job using specified schema (single file as array)
    const job = await this.extractionJobsDb.createExtractionJob({
      organizationId,
      dataLayerIds: [dataLayerId], // Use new array format
      initiatedBy: userId,
      jobType: "material_extraction",
      schemaId,
      config: {}
    });

    this.extractionService.processExtractionJobInBackground(job.id);
  }

  /**
   * Update job progress with workflow information
   */
  private async updateJobProgress(
    jobId: string,
    progress: WorkflowProgress
  ): Promise<void> {
    const status =
      progress.stage === "completed"
        ? ASYNC_JOB_STATUSES.COMPLETED
        : progress.stage === "failed"
          ? ASYNC_JOB_STATUSES.FAILED
          : ASYNC_JOB_STATUSES.RUNNING;

    await this.extractionJobsDb.updateExtractionJobStatus(
      jobId,
      status,
      progress.progress
    );

    // Update results summary with enhanced JSONB workflow info
    const job = await this.extractionJobsDb.getExtractionJobById(jobId);
    if (job) {
      await this.extractionJobsDb.updateExtractionJobStatus(
        jobId,
        job.status as any,
        progress.progress,
        undefined,
        {
          // JSONB allows for more structured workflow data
          workflow: {
            stage: progress.stage,
            message: progress.message,
            extractedFiles: progress.extractedFiles
              ? [progress.extractedFiles.toString()]
              : [],
            completedExtractions: progress.completedExtractions || 0
          }
          // Progress tracking only - no legacy results
        }
      );
    }

    this.logger.log(
      `Job ${jobId} progress: ${progress.stage} (${progress.progress}%) - ${progress.message}`
    );
  }
}
