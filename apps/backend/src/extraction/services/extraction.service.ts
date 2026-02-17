import { Injectable, Logger } from "@nestjs/common";
import {
  AgentDefinition,
  ASYNC_JOB_STATUSES,
  CompiledSchema,
  ExtractionJob,
  StartExtractionJobRequest,
  StartExtractionJobRequestSchema
} from "@packages/types";
import { ConfigService } from "@/config/config.service";
import { AgentDiagnosticsService } from "@/extraction/services/agent-diagnostics.service";
import { AgentExecutionService } from "@/extraction/services/agent-execution.service";
import { ExtractionResultService } from "@/extraction/services/extraction-result.service";
import { ExtractionSchemaService } from "@/extraction/services/extraction-schema.service";
import { PDFExtractionService } from "@/extraction/services/pdf-extraction.service";
import { ZipProcessingService } from "@/extraction/services/zip-processing.service";
import { BlobStorageService } from "@/shared/blob-storage/blob-storage.service";
import { DataLayersDatabaseService } from "@/shared/database/services/data-layers.database.service";
import { ExtractionJobsDatabaseService } from "@/shared/database/services/extraction-jobs.database.service";
import {
  calculateExtractionProgress,
  createJobLogEntry,
  createWorkflowSummary,
  getErrorMessage,
  logExtractionSummary
} from "@/shared/utils/extraction-workflow.utils";
import { MaterialExtractionResult } from "@/shared/utils/extraction.utils";

@Injectable()
export class ExtractionService {
  private logger = new Logger(ExtractionService.name);

  private get flushBatchSize(): number {
    const v = Number(this.configService.get("EXTRACT_FLUSH_BATCH_SIZE"));
    return Number.isFinite(v) && v > 0
      ? Math.min(500, Math.max(1, Math.floor(v)))
      : 10;
  }

  constructor(
    private blobStorageService: BlobStorageService,
    private dataLayersDb: DataLayersDatabaseService,
    private extractionJobsDb: ExtractionJobsDatabaseService,
    private pdfExtractionService: PDFExtractionService,
    private zipProcessingService: ZipProcessingService,
    private extractionResultService: ExtractionResultService,
    private configService: ConfigService,
    private schemaService: ExtractionSchemaService,
    private agentExecutionService: AgentExecutionService,
    private agentDiagnosticsService: AgentDiagnosticsService
  ) {}

  async startExtractionJob(
    organizationId: string,
    userId: string,
    request: StartExtractionJobRequest
  ): Promise<ExtractionJob> {
    const validatedRequest = StartExtractionJobRequestSchema.parse(request);

    // Normalize the request to handle both single and multiple files
    const dataLayerIds = this.getDataLayerIdsFromRequest(validatedRequest);

    // Get and compile the schema
    const compiledSchema = await this.schemaService.getAndCompileById(
      validatedRequest.schemaId
    );

    // Create the extraction job with schema artifacts
    const extractionJob = await this.extractionJobsDb.createExtractionJob({
      ...validatedRequest,
      dataLayerIds,
      organizationId,
      initiatedBy: userId,
      compiledJsonSchema: compiledSchema.jsonSchema
    });

    // Start extraction processing in background
    this.processExtractionJobInBackground(extractionJob.id);

    return extractionJob;
  }

  /**
   * Extract data layer IDs from the request, handling both old and new formats
   */
  private getDataLayerIdsFromRequest(
    request: StartExtractionJobRequest
  ): string[] {
    if (request.dataLayerIds && request.dataLayerIds.length > 0) {
      return request.dataLayerIds;
    }
    if (request.dataLayerId) {
      return [request.dataLayerId];
    }
    throw new Error("No data layer IDs provided in extraction request");
  }

  /**
   * Add a log entry to an extraction job for real-time user feedback
   */
  private async addJobLog(
    jobId: string,
    message: string,
    level: "info" | "warn" | "error" = "info"
  ): Promise<void> {
    const logEntry: {
      timestamp: string;
      level: "info" | "warn" | "error";
      message: string;
    } = createJobLogEntry(message, level);
    await this.extractionJobsDb.appendJobLog(jobId, logEntry);
    this.logger.log(`[Job ${jobId}] ${message}`);
  }

  async getExtractionJobById(jobId: string): Promise<ExtractionJob | null> {
    return this.extractionJobsDb.getExtractionJobById(jobId);
  }

  async getJobWithSchema(jobId: string) {
    const job = await this.extractionJobsDb.getExtractionJobById(jobId);
    if (!job || !job.schemaId) {
      return null;
    }

    // Get schema details using schema service
    const schema = await this.schemaService.getSchemaById(job.schemaId);

    return {
      ...job,
      schema
    };
  }

  async getExtractionJobsByProject(
    projectId: string
  ): Promise<ExtractionJob[]> {
    const jobs =
      await this.extractionJobsDb.getExtractionJobsByProject(projectId);
    return jobs as unknown as ExtractionJob[];
  }

  async processExtractionJobInBackground(jobId: string): Promise<void> {
    const startTime = Date.now();
    const JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes timeout

    try {
      await this.addJobLog(jobId, "🚀 Starting extraction job processing...");

      // Get the extraction job with all its data layers
      const job = await this.extractionJobsDb.getExtractionJobById(jobId);
      if (!job) {
        throw new Error("Extraction job not found");
      }

      // Get the full schema with prompt and examples for dynamic extraction
      const fullSchema = await this.schemaService.getAndCompileById(
        job.schemaId
      );

      // Get all data layers for this job
      let jobDataLayers =
        await this.extractionJobsDb.getExtractionJobDataLayers(jobId);
      if (!jobDataLayers || jobDataLayers.length === 0) {
        throw new Error("No data layers found for extraction job");
      }

      // Update status to running
      await this.extractionJobsDb.updateExtractionJobStatus(
        jobId,
        ASYNC_JOB_STATUSES.RUNNING,
        0
      );

      // Check timeout before processing
      if (Date.now() - startTime > JOB_TIMEOUT_MS) {
        throw new Error(`Job timeout exceeded (${JOB_TIMEOUT_MS / 1000}s)`);
      }

      // FIXED: Check for ZIP files first and process them within the same job
      const zipDataLayers = jobDataLayers.filter(
        (jdl) => jdl.dataLayer.fileType === "zip"
      );

      if (zipDataLayers.length > 0) {
        await this.addJobLog(
          jobId,
          `📦 Found ${zipDataLayers.length} ZIP file(s) to extract`
        );

        // Process each ZIP file and add extracted files to the same job
        for (const zipDataLayer of zipDataLayers) {
          // Check timeout before processing each ZIP
          if (Date.now() - startTime > JOB_TIMEOUT_MS) {
            throw new Error(`Job timeout exceeded during ZIP processing`);
          }

          await this.processZipInSameJob(
            jobId,
            zipDataLayer.dataLayerId,
            job.organizationId
          );
        }

        // Refresh job data layers to include extracted files
        jobDataLayers =
          await this.extractionJobsDb.getExtractionJobDataLayers(jobId);
        await this.addJobLog(
          jobId,
          `🔄 Refreshed job - now processing ${jobDataLayers.length} total files`
        );
      }

      // Final timeout check before main processing
      if (Date.now() - startTime > JOB_TIMEOUT_MS) {
        throw new Error(`Job timeout exceeded before main processing`);
      }

      // Process all files (including newly extracted ones from ZIP) in a single job
      await this.processMultipleFilesInJob(
        jobId,
        jobDataLayers,
        startTime,
        JOB_TIMEOUT_MS,
        fullSchema
      );

      await this.addJobLog(jobId, "✅ Extraction job completed successfully!");
      this.logger.log(
        `Extraction job completed successfully: ${jobId} (${Date.now() - startTime}ms)`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const duration = Date.now() - startTime;

      await this.addJobLog(
        jobId,
        `❌ Extraction job failed after ${Math.round(duration / 1000)}s: ${errorMessage}`,
        "error"
      );

      this.logger.error(`Extraction job failed: ${jobId}`, {
        error: errorMessage,
        duration,
        isTimeout: errorMessage.includes("timeout")
      });

      // Update job status to failed
      await this.extractionJobsDb.updateExtractionJobStatus(
        jobId,
        ASYNC_JOB_STATUSES.FAILED,
        undefined,
        errorMessage
      );

      // Update all data layers status to failed
      try {
        const jobDataLayers =
          await this.extractionJobsDb.getExtractionJobDataLayers(jobId);
        for (const jobDataLayer of jobDataLayers) {
          await this.dataLayersDb.updateDataLayerProcessingStatus(
            jobDataLayer.dataLayerId,
            ASYNC_JOB_STATUSES.FAILED,
            errorMessage
          );
          await this.extractionJobsDb.updateExtractionJobDataLayerStatus(
            jobId,
            jobDataLayer.dataLayerId,
            "failed"
          );
        }
      } catch (cleanupError) {
        this.logger.error(
          `Failed to cleanup failed job ${jobId}:`,
          cleanupError
        );
      }
    }
  }

  /**
   * Process multiple files within a single extraction job
   */
  private async processMultipleFilesInJob(
    jobId: string,
    jobDataLayers: Array<{
      id: string;
      dataLayerId: string;
      extractionJobId: string;
      dataLayer: {
        id: string;
        name: string;
        fileType: string;
        filePath: string;
      };
    }>,
    startTime?: number,
    timeoutMs?: number,
    fullSchema?: CompiledSchema
  ): Promise<void> {
    const allExtractionResults: MaterialExtractionResult[] = [];
    const resultBuffer: MaterialExtractionResult[] = [];
    let completedFiles = 0;
    let hasAnyAgentErrors = false;

    await this.addJobLog(
      jobId,
      `📋 Processing ${jobDataLayers.length} files in batch`
    );

    for (const jobDataLayer of jobDataLayers) {
      const dataLayer = jobDataLayer.dataLayer;

      try {
        // Check timeout if parameters provided
        if (startTime && timeoutMs && Date.now() - startTime > timeoutMs) {
          throw new Error(
            `Job timeout exceeded while processing ${dataLayer.name}`
          );
        }

        // Skip ZIP files - they were already processed and their contents added to the job
        if (dataLayer.fileType === "zip") {
          await this.addJobLog(
            jobId,
            `⏩ Skipping ZIP file ${dataLayer.name} (already processed)`
          );
          completedFiles++;
          continue;
        }

        await this.addJobLog(
          jobId,
          `📄 Processing file ${completedFiles + 1}/${jobDataLayers.length}: ${dataLayer.name}`
        );

        // Update this data layer status to processing
        await this.extractionJobsDb.updateExtractionJobDataLayerStatus(
          jobId,
          dataLayer.id,
          "processing"
        );

        await this.dataLayersDb.updateDataLayerProcessingStatus(
          dataLayer.id,
          ASYNC_JOB_STATUSES.RUNNING
        );

        // Download file from S3
        this.logger.log(`Downloading file from S3: ${dataLayer.filePath}`);
        await this.addJobLog(
          jobId,
          `⬇️ Downloading ${dataLayer.name} from storage`
        );
        const fileBuffer = await this.blobStorageService.getFromProcessing(
          dataLayer.filePath
        );

        let extractionResults: MaterialExtractionResult[] = [];

        if (dataLayer.fileType === "pdf") {
          await this.addJobLog(
            jobId,
            `📖 Starting PDF extraction for ${dataLayer.name}`
          );
          const extractionOutput =
            await this.pdfExtractionService.processPDFExtraction(
              fileBuffer,
              jobId,
              fullSchema
            );
          extractionResults = extractionOutput.results;

          // Log if there were failed batches
          if (extractionOutput.failedBatches.length > 0) {
            this.logger.warn(
              JSON.stringify({
                level: "warn",
                action: "pdfExtractionPartialFailure",
                jobId,
                dataLayerId: dataLayer.id,
                failedBatches: extractionOutput.failedBatches
              })
            );
          }

          // Check if schema has agents and apply them in HYBRID BATCH (super efficient!)
          if (fullSchema?.agents && fullSchema.agents.length > 0) {
            await this.addJobLog(
              jobId,
              `🤖 Applying ${fullSchema.agents.length} post-processing agents to ${extractionResults.length} results (hybrid batch mode)`
            );

            try {
              // Execute agent pipeline on ALL results at once (much faster!)
              const batchResults =
                await this.agentExecutionService.executeAgentPipelineBatch(
                  (fullSchema.agents || []) as AgentDefinition[],
                  extractionResults,
                  {
                    name: fullSchema.name || "Unknown Schema",
                    definition: fullSchema.jsonSchema
                  }
                );

              // Map batch results back to extraction results
              const processedResults: MaterialExtractionResult[] =
                batchResults.map((batchResult) => ({
                  ...(batchResult.finalOutput as MaterialExtractionResult),
                  agentExecutionMetadata: batchResult.metadata,
                  sourceDataLayerId: dataLayer.id,
                  sourceFileName: dataLayer.name
                }));

              extractionResults = processedResults;

              // Analyze agent execution for detailed diagnostics
              const allMetadata = batchResults.map((r) => r.metadata);
              const diagnostics =
                this.agentDiagnosticsService.analyzePipelineExecution(
                  allMetadata,
                  fullSchema.agents.length
                );

              // Log diagnostics
              this.logger.log(
                this.agentDiagnosticsService.formatForLogging(diagnostics)
              );

              // Check if any results had errors (check metadata for failure statuses)
              const hasErrors = batchResults.some((r) =>
                r.metadata.some(
                  (m) => m.status === "failed" || m.status === "timeout"
                )
              );

              if (hasErrors) {
                hasAnyAgentErrors = true;

                // Generate detailed error message
                const failedAgents = diagnostics.agentErrors.filter(
                  (a) => a.successRate < 100
                );
                const errorSummary = failedAgents
                  .map(
                    (a) =>
                      `${a.agentName}: ${a.failureCount} failures (${a.successRate.toFixed(1)}% success)`
                  )
                  .join("; ");

                await this.addJobLog(
                  jobId,
                  `⚠️ Agent issues detected: ${errorSummary}. Overall success: ${diagnostics.overallSuccessRate.toFixed(1)}%`,
                  "warn"
                );

                // Add recommendations if there are critical issues
                if (diagnostics.criticalIssues.length > 0) {
                  await this.addJobLog(
                    jobId,
                    `💡 Issues: ${diagnostics.criticalIssues.join("; ")}`,
                    "info"
                  );
                }
              } else {
                await this.addJobLog(
                  jobId,
                  `✅ All agents completed successfully (processed ${extractionResults.length} results, success rate: ${diagnostics.overallSuccessRate.toFixed(1)}%)`
                );
              }
            } catch (error) {
              // If batch processing fails completely, use original results
              this.logger.error(
                JSON.stringify({
                  level: "error",
                  action: "agentPipelineFailed",
                  jobId,
                  error: getErrorMessage(error),
                  timestamp: new Date().toISOString()
                })
              );
              await this.addJobLog(
                jobId,
                `⚠️ Batch agent pipeline failed: ${getErrorMessage(error)}. Using original extractions.`,
                "warn"
              );
              hasAnyAgentErrors = true;
            }
          }
        } else {
          this.logger.warn(
            `Unsupported file type: ${dataLayer.fileType} for file: ${dataLayer.name}`
          );
          await this.addJobLog(
            jobId,
            `⚠️ Skipping ${dataLayer.name}: Unsupported file type (${dataLayer.fileType})`,
            "warn"
          );
          continue;
        }

        // Add file identifier to results for tracking (if not already added by agent processing)
        const resultsWithFileInfo = extractionResults.map((result) => ({
          ...result,
          sourceDataLayerId: result.sourceDataLayerId || dataLayer.id,
          sourceFileName: result.sourceFileName || dataLayer.name
        }));

        allExtractionResults.push(...resultsWithFileInfo);
        // Flush buffered results in batches to reduce memory and surface results sooner
        resultBuffer.push(...resultsWithFileInfo);
        if (resultBuffer.length >= this.flushBatchSize) {
          await this.addJobLog(
            jobId,
            `💾 Saving ${resultBuffer.length} extracted materials to database (batch)`
          );
          await this.processExtractionResults(jobId, resultBuffer);
          resultBuffer.length = 0;
        }

        // Update this data layer status to completed
        await this.dataLayersDb.updateDataLayerProcessingStatus(
          dataLayer.id,
          ASYNC_JOB_STATUSES.COMPLETED
        );

        await this.extractionJobsDb.updateExtractionJobDataLayerStatus(
          jobId,
          dataLayer.id,
          "completed"
        );

        completedFiles++;

        // Update overall job progress
        const progress = calculateExtractionProgress(
          completedFiles,
          jobDataLayers.length,
          10
        );
        const progressMeta = {
          currentPage: completedFiles,
          totalPages: jobDataLayers.length,
          completedPages: completedFiles,
          totalMaterialsFound: allExtractionResults.length
        };

        this.logger.log(
          `[Job ${jobId}] Updating progress: ${completedFiles}/${jobDataLayers.length} files, meta:`,
          progressMeta
        );

        await this.extractionJobsDb.updateExtractionJobStatus(
          jobId,
          ASYNC_JOB_STATUSES.RUNNING,
          progress,
          undefined,
          progressMeta
        );

        await this.addJobLog(
          jobId,
          `✅ Completed ${dataLayer.name}: ${extractionResults.length} materials extracted (${completedFiles}/${jobDataLayers.length})`
        );
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        await this.addJobLog(
          jobId,
          `❌ Failed to process ${dataLayer.name}: ${errorMessage}`,
          "error"
        );

        this.logger.error(`Failed to process file: ${dataLayer.name}`, {
          error: errorMessage,
          jobId,
          dataLayerId: dataLayer.id,
          completedFiles,
          totalFiles: jobDataLayers.length
        });

        // Update this data layer status to failed but continue with other files
        await this.dataLayersDb.updateDataLayerProcessingStatus(
          dataLayer.id,
          ASYNC_JOB_STATUSES.FAILED,
          errorMessage
        );

        await this.extractionJobsDb.updateExtractionJobDataLayerStatus(
          jobId,
          dataLayer.id,
          "failed"
        );

        // Continue processing other files
        completedFiles++;
      }
    }

    // Flush any remaining buffered results
    if (resultBuffer.length > 0) {
      await this.addJobLog(
        jobId,
        `💾 Saving ${resultBuffer.length} extracted materials to database (final batch)`
      );
      await this.processExtractionResults(jobId, resultBuffer);
      resultBuffer.length = 0;
    }

    if (allExtractionResults.length === 0) {
      await this.addJobLog(
        jobId,
        `📭 No materials were extracted from any files`
      );
    }

    // Calculate final statistics and create summary
    const workflowSummary = createWorkflowSummary(
      allExtractionResults,
      completedFiles,
      jobDataLayers.length
    );

    // Add extracted file names to workflow
    workflowSummary.workflow.extractedFiles = jobDataLayers.map(
      (jdl) => jdl.dataLayer.name
    );

    // Determine final job status - completed (warnings tracked in meta)
    const finalStatus = ASYNC_JOB_STATUSES.COMPLETED;

    // Update final job status
    await this.extractionJobsDb.updateExtractionJobStatus(
      jobId,
      finalStatus,
      100,
      undefined,
      workflowSummary
    );

    const statusMessage = `🎉 Extraction completed! Processed ${completedFiles}/${jobDataLayers.length} files, extracted ${allExtractionResults.length} materials (avg confidence: ${(workflowSummary.summary.averageConfidence * 100).toFixed(1)}%)${hasAnyAgentErrors ? ". Some post-processing agents encountered errors (check logs for details)." : ""}`;

    await this.addJobLog(jobId, statusMessage);

    logExtractionSummary(
      jobDataLayers.length,
      completedFiles,
      jobDataLayers.length - completedFiles,
      allExtractionResults.length
    );
  }

  /**
   * Process ZIP file within the same extraction job (FIXED VERSION)
   * This replaces the old broken logic that created N separate jobs
   */
  private async processZipInSameJob(
    jobId: string,
    zipDataLayerId: string,
    organizationId: string
  ): Promise<void> {
    await this.addJobLog(jobId, "🗜️ Starting ZIP file extraction...");

    // Get ZIP data layer info
    const zipDataLayer =
      await this.dataLayersDb.getDataLayerById(zipDataLayerId);
    if (!zipDataLayer) {
      throw new Error("ZIP data layer not found");
    }

    await this.addJobLog(
      jobId,
      `📂 Extracting contents from ZIP file: ${zipDataLayer.name}`
    );

    // Process ZIP file and extract contents
    const result = await this.zipProcessingService.processZipFile(
      zipDataLayerId,
      organizationId,
      zipDataLayer.projectId
    );

    if (!result.success) {
      await this.addJobLog(
        jobId,
        `❌ ZIP extraction failed: ${result.error || "Unknown error"}`,
        "error"
      );
      throw new Error(result.error || "ZIP processing failed");
    }

    await this.addJobLog(
      jobId,
      `📁 Successfully extracted ${result.extractedFiles.length} files from ZIP: ${zipDataLayer.name}`
    );

    // Log details about extracted files
    if (result.extractedFiles.length > 0) {
      const fileTypes = result.extractedFiles.reduce(
        (acc: { [key: string]: number }, file) => {
          const ext = file.name.split(".").pop()?.toLowerCase() || "unknown";
          acc[ext] = (acc[ext] || 0) + 1;
          return acc;
        },
        {}
      );

      const typesSummary = Object.entries(fileTypes)
        .map(([type, count]) => `${count} ${type.toUpperCase()}`)
        .join(", ");

      await this.addJobLog(jobId, `📊 Extracted file types: ${typesSummary}`);
    }

    // CRITICAL FIX: Add extracted files to the SAME job instead of creating N new jobs
    await this.addJobLog(
      jobId,
      `🔗 Adding ${result.dataLayerIds.length} extracted files to current job...`
    );
    for (let i = 0; i < result.dataLayerIds.length; i++) {
      const extractedDataLayerId = result.dataLayerIds[i];
      await this.extractionJobsDb.addDataLayerToJob(
        jobId,
        extractedDataLayerId,
        i + 1 // processingOrder (ZIP file is 0, extracted files start at 1)
      );
    }

    await this.addJobLog(
      jobId,
      `✅ Added ${result.dataLayerIds.length} extracted files to current job for processing`
    );

    // Mark ZIP data layer as completed
    await this.dataLayersDb.updateDataLayerProcessingStatus(
      zipDataLayerId,
      ASYNC_JOB_STATUSES.COMPLETED
    );

    await this.extractionJobsDb.updateExtractionJobDataLayerStatus(
      jobId,
      zipDataLayerId,
      "completed"
    );
  }

  /**
   * Process extraction results using the new ExtractionResult table
   */
  async processExtractionResults(
    jobId: string,
    results: MaterialExtractionResult[]
  ): Promise<void> {
    try {
      // Create individual extraction result records with evidence separation
      await this.extractionResultService.createResultsWithEvidence(
        jobId,
        results as unknown as Array<Record<string, unknown>>
      );

      this.logger.log(
        `Created ${results.length} extraction result records for job ${jobId}`
      );
    } catch (error) {
      this.logger.error(
        `Failed to process extraction results for job ${jobId}`,
        {
          error: error instanceof Error ? error.message : String(error)
        }
      );
      throw error;
    }
  }
}
