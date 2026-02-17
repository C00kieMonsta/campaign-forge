/**
 * PDF Extraction Service
 * Handles PDF-specific extraction logic using Gemini File API
 *
 * Features:
 * - Direct PDF processing via Gemini File API (no image conversion)
 * - Full document context for cross-page item extraction
 * - Items spanning multiple pages are automatically merged by the LLM
 * - Per-request LLM parameter control (temperature, maxTokens, timeout)
 * - Centralized LLM service with provider fallback
 * - Performance instrumentation with detailed timing metrics
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  ASYNC_JOB_STATUSES,
  TASK_CRITICALITY,
  type CompiledSchema
} from "@packages/types";
import { ConfigService } from "@/config/config.service";
import { PDFProcessingService } from "@/extraction/services/pdf-processing.service";
import { ExtractionJobsDatabaseService } from "@/shared/database/services/extraction-jobs.database.service";
import { LLMService } from "@/shared/llm/llm.service";
import { parseExtractionResponse } from "@/shared/utils/extraction-parsing.utils";
import { buildPDFExtractionPrompt } from "@/shared/utils/extraction-vision.utils";
import { getErrorMessage } from "@/shared/utils/extraction-workflow.utils";
import { MaterialExtractionResult } from "@/shared/utils/extraction.utils";

@Injectable()
export class PDFExtractionService {
  private logger = new Logger(PDFExtractionService.name);

  constructor(
    private pdfProcessingService: PDFProcessingService,
    private llmService: LLMService,
    private extractionJobsDb: ExtractionJobsDatabaseService,
    private configService: ConfigService
  ) {}

  /**
   * Add a log entry to an extraction job
   */
  private async addJobLog(
    jobId: string,
    message: string,
    level: "info" | "warn" | "error" = "info"
  ): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message
    };
    await this.extractionJobsDb.appendJobLog(jobId, logEntry);
    this.logger.log(`[Job ${jobId}] ${message}`);
  }

  /**
   * Process PDF extraction in batches using Gemini File API
   * Splits PDF into page batches to avoid token limits and ensure complete extraction
   */
  async processPDFExtraction(
    pdfBuffer: Buffer,
    jobId: string,
    fullSchema?: CompiledSchema
  ): Promise<{
    results: MaterialExtractionResult[];
    failedBatches: Array<{ start: number; end: number; error: string }>;
  }> {
    this.logger.log(`Processing PDF extraction for job: ${jobId}`);
    await this.addJobLog(
      jobId,
      `📋 Starting PDF processing using Gemini File API with batching`
    );

    const startTime = Date.now();
    const BATCH_SIZE = 5; // Pages per batch

    try {
    // Validate PDF
    const isValidPDF = await this.pdfProcessingService.validatePDF(pdfBuffer);
    if (!isValidPDF) {
      await this.addJobLog(jobId, "❌ PDF validation failed", "error");
      throw new Error("Invalid PDF file");
    }

    await this.addJobLog(jobId, "✅ PDF validation successful");

      // Get total page count
      const totalPages =
        await this.pdfProcessingService.getPageCount(pdfBuffer);
      this.logger.log(
        `PDF has ${totalPages} pages, will process in batches of ${BATCH_SIZE}`
      );
    await this.addJobLog(
      jobId,
        `📄 PDF contains ${totalPages} pages, processing in batches of ${BATCH_SIZE}`
    );

      // Calculate number of batches
      const numBatches = Math.ceil(totalPages / BATCH_SIZE);
    const allResults: MaterialExtractionResult[] = [];
      const failedBatches: Array<{
        start: number;
        end: number;
        error: string;
      }> = [];

    // Process each batch
      for (let batchIndex = 0; batchIndex < numBatches; batchIndex++) {
        const startPage = batchIndex * BATCH_SIZE + 1;
        const endPage = Math.min(startPage + BATCH_SIZE - 1, totalPages);

        this.logger.log(
          `Processing batch ${batchIndex + 1}/${numBatches}: pages ${startPage}-${endPage}`
        );
        await this.addJobLog(
          jobId,
          `🔄 Processing batch ${batchIndex + 1}/${numBatches}: pages ${startPage}-${endPage}`
          );

          try {
          // Extract page range as sub-PDF
          const batchPdfBuffer =
            await this.pdfProcessingService.extractPageRange(
              pdfBuffer,
              startPage,
              endPage
            );

          // Build extraction prompt with batch context
          const { systemPrompt, userPrompt } = buildPDFExtractionPrompt(
            fullSchema,
            startPage,
            endPage,
            totalPages
          );

          // Update progress based on batch completion
          const progress = Math.floor(
            20 + ((batchIndex + 1) / numBatches) * 60
          );
        await this.extractionJobsDb.updateExtractionJobStatus(
          jobId,
          ASYNC_JOB_STATUSES.RUNNING,
          progress,
          undefined,
          {
              stage: "extracting_data",
              currentBatch: batchIndex + 1,
              totalBatches: numBatches,
              pagesProcessed: endPage
            }
          );

          const extractionStartTime = Date.now();

          // Log batch processing start
    this.logger.log(
            `[Batch ${batchIndex + 1}] Starting LLM extraction (${Math.round(batchPdfBuffer.length / 1024)} KB)...`
          );
          console.log(
            `[Extraction Batch ${batchIndex + 1}/${numBatches}] Sending to Gemini (${Math.round(batchPdfBuffer.length / 1024)} KB, pages ${startPage}-${endPage})...`
          );

          // Send batch PDF to Gemini with extraction prompt
          this.logger.log(
            `[Batch ${batchIndex + 1}] Calling llmService.generateWithBuffers...`
        );
        const response = await this.llmService.generateWithBuffers(
          systemPrompt,
          userPrompt,
            batchPdfBuffer,
            "application/pdf",
          undefined,
          TASK_CRITICALITY.HIGH,
          {
            temperature: 0.2,
              maxOutputTokens: 16384,
              timeout: 240000 // 4 minutes per batch
          },
            jobId
          );

          const extractionTime = Date.now() - extractionStartTime;

          this.logger.log(
            `[Batch ${batchIndex + 1}] LLM response received (${extractionTime}ms), response type: ${typeof response}, length: ${typeof response === "string" ? response.length : "N/A"}`
          );
          console.log(
            `[Extraction Batch ${batchIndex + 1}] Received response: ${typeof response === "string" ? response.length : "N/A"} chars in ${extractionTime}ms`
          );

          // Parse the batch response
          this.logger.log(
            `[Batch ${batchIndex + 1}] Parsing extraction response...`
          );
          const batchMaterials = parseExtractionResponse(
          response as string,
            startPage,
          fullSchema?.outputSchema
          );

        this.logger.log(
            `Batch ${batchIndex + 1} complete: ${batchMaterials.length} materials in ${extractionTime}ms`
          );
          console.log(
            `[Extraction Batch ${batchIndex + 1}] ✅ Parsed ${batchMaterials.length} items in ${extractionTime}ms`
        );

          await this.addJobLog(
            jobId,
            `✅ Batch ${batchIndex + 1}: ${batchMaterials.length} items extracted`
          );

          allResults.push(...batchMaterials);
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          this.logger.error(
            `Batch ${batchIndex + 1} failed (pages ${startPage}-${endPage}): ${errorMessage}`
          );
          await this.addJobLog(
            jobId,
            `⚠️ Batch ${batchIndex + 1} failed (pages ${startPage}-${endPage}): ${errorMessage}`,
          "warn"
        );

          failedBatches.push({
            start: startPage,
            end: endPage,
            error: errorMessage
          });
        }
      }

      const totalTime = Date.now() - startTime;

      this.logger.log(
        `PDF extraction complete: ${allResults.length} materials from ${numBatches} batches in ${totalTime}ms`
      );

    await this.addJobLog(
      jobId,
        `✅ Extraction complete: ${allResults.length} materials found in ${Math.round(totalTime / 1000)}s (${failedBatches.length} failed batches)`
    );

      return {
        results: allResults,
        failedBatches
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(
        JSON.stringify({
          level: "error",
          action: "pdfExtractionFailed",
          jobId,
          error: errorMessage
        })
      );
      await this.addJobLog(
        jobId,
        `❌ PDF extraction failed: ${errorMessage}`,
        "error"
      );

      throw error;
    }
  }
}
