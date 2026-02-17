// src/repositories/IExtractionResultRepository.ts
import type {
  CreateManualResultRequest,
  ExtractionResultStatus,
  ExtractionResultWithEvidence,
  ResultsStatsResponse,
  UpdateExtractionResultRequest,
  UpdateExtractionResultStatusRequest,
  VerificationStatsResponse,
  VerifyExtractionResultRequest
} from "../dto/extractions";
import type { ExtractionResult } from "../entities/extraction_result";

/**
 * Repository interface for ExtractionResult domain operations
 *
 * Provides domain-specific methods for managing extraction results,
 * including CRUD operations, verification, and statistics.
 */
export interface IExtractionResultRepository {
  /**
   * Get an extraction result by ID
   * @param resultId - ExtractionResult identifier
   * @returns Promise resolving to extraction result or null if not found
   */
  getExtractionResultById(resultId: string): Promise<ExtractionResult | null>;

  /**
   * Get all extraction results for a job
   * @param jobId - ExtractionJob identifier
   * @returns Promise resolving to array of extraction results
   */
  getExtractionResultsByJob(jobId: string): Promise<ExtractionResult[]>;

  /**
   * Get extraction results for a job with pagination
   * @param jobId - ExtractionJob identifier
   * @param page - Page number (1-indexed)
   * @param limit - Number of results per page
   * @returns Promise resolving to paginated results with total count
   */
  getExtractionResultsByJobWithPagination(
    jobId: string,
    page: number,
    limit: number
  ): Promise<{ results: ExtractionResult[]; total: number }>;

  /**
   * Create a manual extraction result (user-created)
   * @param data - Manual result creation data
   * @returns Promise resolving to created extraction result
   */
  createManualExtractionResult(
    data: CreateManualResultRequest
  ): Promise<ExtractionResult>;

  /**
   * Update an extraction result
   * @param resultId - ExtractionResult identifier
   * @param data - Update data
   * @returns Promise resolving to updated extraction result
   */
  updateExtractionResult(
    resultId: string,
    data: UpdateExtractionResultRequest
  ): Promise<ExtractionResult>;

  /**
   * Update extraction result status
   * @param resultId - ExtractionResult identifier
   * @param status - New status
   * @param notes - Optional notes for the status change
   * @returns Promise resolving to updated extraction result
   */
  updateExtractionResultStatus(
    resultId: string,
    status: ExtractionResultStatus,
    notes?: string
  ): Promise<ExtractionResult>;

  /**
   * Verify an extraction result with human-verified data
   * @param resultId - ExtractionResult identifier
   * @param data - Verification data
   * @param verifiedBy - User ID who verified the result
   * @returns Promise resolving to verified extraction result
   */
  verifyExtractionResult(
    resultId: string,
    data: VerifyExtractionResultRequest,
    verifiedBy: string
  ): Promise<ExtractionResult>;

  /**
   * Delete an extraction result
   * @param resultId - ExtractionResult identifier
   * @returns Promise resolving when deletion is complete
   */
  deleteExtractionResult(resultId: string): Promise<void>;

  /**
   * Delete multiple extraction results
   * @param resultIds - Array of ExtractionResult identifiers
   * @returns Promise resolving when deletion is complete
   */
  deleteExtractionResults(resultIds: string[]): Promise<void>;

  /**
   * Get extraction results filtered by status
   * @param jobId - ExtractionJob identifier
   * @param status - Status to filter by
   * @returns Promise resolving to array of extraction results
   */
  getExtractionResultsByStatus(
    jobId: string,
    status: ExtractionResultStatus
  ): Promise<ExtractionResult[]>;

  /**
   * Get extraction results filtered by confidence score
   * @param jobId - ExtractionJob identifier
   * @param minScore - Minimum confidence score (0-1)
   * @returns Promise resolving to array of extraction results
   */
  getExtractionResultsByConfidenceScore(
    jobId: string,
    minScore: number
  ): Promise<ExtractionResult[]>;

  /**
   * Get extraction results with evidence (enhanced view)
   * @param jobId - ExtractionJob identifier
   * @returns Promise resolving to array of extraction results with evidence
   */
  getExtractionResultsWithEvidence(
    jobId: string
  ): Promise<ExtractionResultWithEvidence[]>;

  /**
   * Get statistics for extraction results in a job
   * @param jobId - ExtractionJob identifier
   * @returns Promise resolving to results statistics
   */
  getResultsStats(jobId: string): Promise<ResultsStatsResponse>;

  /**
   * Get verification statistics for a job
   * @param jobId - ExtractionJob identifier
   * @returns Promise resolving to verification statistics
   */
  getVerificationStats(jobId: string): Promise<VerificationStatsResponse>;
}
