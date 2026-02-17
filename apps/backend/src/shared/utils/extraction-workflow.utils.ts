/**
 * Shared workflow utilities for extraction services
 */

import { Logger } from "@nestjs/common";

const logger = new Logger("ExtractionWorkflowUtils");

export interface WorkflowProgress {
  stage: "upload" | "unzipping" | "extracting" | "completed" | "failed";
  progress: number;
  message: string;
  extractedFiles?: number;
  completedExtractions?: number;
}

/**
 * Calculate extraction progress based on completed files
 */
export function calculateExtractionProgress(
  completedFiles: number,
  totalFiles: number,
  reservePercentage: number = 10
): number {
  const maxProgress = 100 - reservePercentage;
  return Math.round((completedFiles / totalFiles) * maxProgress);
}

/**
 * Create extraction job log entry
 */
export function createJobLogEntry(
  message: string,
  level: "info" | "warn" | "error" = "info"
): { timestamp: string; level: "info" | "warn" | "error"; message: string } {
  return {
    timestamp: new Date().toISOString(),
    level,
    message
  };
}

/**
 * Log extraction summary
 */
export function logExtractionSummary(
  totalPages: number,
  successfulPages: number,
  failedPages: number,
  totalMaterials: number
): void {
  logger.log(`=== EXTRACTION SUMMARY ===`);
  logger.log(`Total pages processed: ${totalPages}`);
  logger.log(`Successful pages: ${successfulPages}`);
  logger.log(`Failed pages: ${failedPages}`);
  logger.log(`Total materials extracted: ${totalMaterials}`);

  if (failedPages > 0) {
    logger.warn(`Some pages failed during extraction`);
  }
}

/**
 * Calculate average confidence score
 */
export function calculateAverageConfidence(
  results: Array<{ confidenceScore?: number | null }>
): number {
  if (results.length === 0) return 0;

  const validConfidences = results
    .map((result) => result.confidenceScore || 0)
    .filter((score) => score > 0);

  if (validConfidences.length === 0) return 0;

  return (
    validConfidences.reduce((sum, score) => sum + score, 0) /
    validConfidences.length
  );
}

/**
 * Create workflow results summary
 */
export function createWorkflowSummary(
  results: Array<{ confidenceScore?: number | null }>,
  completedFiles: number,
  totalFiles: number
): {
  summary: {
    totalItems: number;
    totalValue: number;
    currency: string;
    averageConfidence: number;
    extractedMaterials: number;
    processedFiles: number;
    totalFiles: number;
  };
  workflow: {
    stage: string;
    message: string;
    extractedFiles: string[];
    completedExtractions: number;
  };
} {
  const avgConfidence = calculateAverageConfidence(results);

  return {
    summary: {
      totalItems: results.length,
      totalValue: results.reduce(
        (sum, result) =>
          sum +
          (((result as unknown as Record<string, unknown>)
            .totalPrice as number) || 0),
        0
      ),
      currency: "EUR",
      averageConfidence: avgConfidence,
      extractedMaterials: results.length,
      processedFiles: completedFiles,
      totalFiles: totalFiles
    },
    workflow: {
      stage: "completed",
      message: `Extraction completed for ${completedFiles}/${totalFiles} files`,
      extractedFiles: [], // This should be populated by caller
      completedExtractions: results.length
    }
  };
}

/**
 * Safe error message extraction
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
