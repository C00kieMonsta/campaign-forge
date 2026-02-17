/**
 * useExtractionResultRepository Hook
 *
 * Provides access to ExtractionResultRepository for mutations and data fetching.
 * Combines store-first reading with repository-based mutations.
 *
 * This hook bridges the gap between:
 * - Store-first reading (via useExtractionResultsForJob)
 * - Repository-based mutations (create, update, delete, verify)
 *
 * Requirements: 3.4, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 11.2, 11.3, 11.4
 */

import { useCallback } from "react";
import type {
  CreateManualResultRequest,
  ExtractionResult,
  ExtractionResultStatus,
  UpdateExtractionResultRequest,
  VerifyExtractionResultRequest
} from "@packages/types";
import {
  useExtractionResultsForJob,
  type UseExtractionResultsForJobReturn
} from "./use-extraction-results-for-job";
import { usePersistence } from "./use-persistence";

/**
 * Return type for useExtractionResultRepository hook
 */
export interface UseExtractionResultRepositoryReturn
  extends UseExtractionResultsForJobReturn {
  /** Fetch results for the job (hydrates store) */
  fetchResults: () => Promise<ExtractionResult[]>;
  /** Create a new extraction result (manual) */
  createResult: (data: CreateManualResultRequest) => Promise<ExtractionResult>;
  /** Create a manual extraction result */
  createManualResult: (
    data: CreateManualResultRequest
  ) => Promise<ExtractionResult>;
  /** Update an extraction result */
  updateResult: (
    resultId: string,
    data: UpdateExtractionResultRequest
  ) => Promise<ExtractionResult>;
  /** Update result status */
  updateResultStatus: (
    resultId: string,
    status: ExtractionResultStatus,
    notes?: string
  ) => Promise<ExtractionResult>;
  /** Verify an extraction result */
  verifyResult: (
    resultId: string,
    data: VerifyExtractionResultRequest,
    verifiedBy: string
  ) => Promise<ExtractionResult>;
  /** Delete an extraction result */
  deleteResult: (resultId: string) => Promise<void>;
  /** Delete multiple extraction results */
  deleteResults: (resultIds: string[]) => Promise<void>;
  /** Get a single result by ID from store */
  getResultById: (resultId: string) => ExtractionResult | undefined;
  /** Check if WebSocket subscription is active */
  isSubscribed: boolean;
}

/**
 * Hook that provides both store-first reading and repository mutations
 * for extraction results.
 *
 * @param jobId - The extraction job ID
 * @returns Object with results from store and mutation methods
 *
 * @example
 * const {
 *   results,
 *   stats,
 *   fetchResults,
 *   updateResultStatus,
 *   deleteResult
 * } = useExtractionResultRepository(jobId);
 *
 * // Results are read from store (realtime updates via WebSocket)
 * // Mutations go through repository (which updates store)
 */
export function useExtractionResultRepository(
  jobId: string | null
): UseExtractionResultRepositoryReturn {
  const persistence = usePersistence();

  // Get store-first reading capabilities
  const storeData = useExtractionResultsForJob(jobId);

  // Fetch results from backend and hydrate store
  const fetchResults = useCallback(async (): Promise<ExtractionResult[]> => {
    if (!jobId) return [];
    return persistence.extractionResults.getExtractionResultsByJob(jobId);
  }, [jobId, persistence]);

  // Create a new extraction result (manual)
  const createResult = useCallback(
    async (data: CreateManualResultRequest): Promise<ExtractionResult> => {
      return persistence.extractionResults.createManualExtractionResult(data);
    },
    [persistence]
  );

  // Create a manual extraction result
  const createManualResult = useCallback(
    async (data: CreateManualResultRequest): Promise<ExtractionResult> => {
      return persistence.extractionResults.createManualExtractionResult(data);
    },
    [persistence]
  );

  // Update an extraction result
  const updateResult = useCallback(
    async (
      resultId: string,
      data: UpdateExtractionResultRequest
    ): Promise<ExtractionResult> => {
      return persistence.extractionResults.updateExtractionResult(
        resultId,
        data
      );
    },
    [persistence]
  );

  // Update result status
  const updateResultStatus = useCallback(
    async (
      resultId: string,
      status: ExtractionResultStatus,
      notes?: string
    ): Promise<ExtractionResult> => {
      return persistence.extractionResults.updateExtractionResultStatus(
        resultId,
        status,
        notes
      );
    },
    [persistence]
  );

  // Verify an extraction result
  const verifyResult = useCallback(
    async (
      resultId: string,
      data: VerifyExtractionResultRequest,
      verifiedBy: string
    ): Promise<ExtractionResult> => {
      return persistence.extractionResults.verifyExtractionResult(
        resultId,
        data,
        verifiedBy
      );
    },
    [persistence]
  );

  // Delete an extraction result
  const deleteResult = useCallback(
    async (resultId: string): Promise<void> => {
      return persistence.extractionResults.deleteExtractionResult(resultId);
    },
    [persistence]
  );

  // Delete multiple extraction results
  const deleteResults = useCallback(
    async (resultIds: string[]): Promise<void> => {
      return persistence.extractionResults.deleteExtractionResults(resultIds);
    },
    [persistence]
  );

  // Get a single result by ID from the results array
  const getResultById = useCallback(
    (resultId: string): ExtractionResult | undefined => {
      return storeData.results.find((r) => r.id === resultId);
    },
    [storeData.results]
  );

  // Check if WebSocket subscription is active
  const isSubscribed = persistence.extractionResults.isSubscribed();

  return {
    ...storeData,
    fetchResults,
    createResult,
    createManualResult,
    updateResult,
    updateResultStatus,
    verifyResult,
    deleteResult,
    deleteResults,
    getResultById,
    isSubscribed
  };
}
