/**
 * useExtractionResultsForJob Hook
 *
 * ✅ STORE-FIRST: Reads extraction results for a job from Redux store ONLY
 *
 * This is a read-only hook. It does NOT fetch data.
 * Fetching is orchestrated at the app level or by explicit repository calls.
 *
 * Features:
 * - Reads from Redux store (single source of truth)
 * - Memoized filtering to prevent unnecessary re-renders
 * - WebSocket updates handled by ExtractionResultRepository at persistence layer
 * - Provides computed stats and filtered result sets
 *
 * Requirements: 6.1, 6.2, 6.3, 11.1, 11.2, 11.3, 11.4, 13.1, 13.2, 13.3, 13.4, 13.5
 */

import { useMemo } from "react";
import type { ExtractionResult } from "@packages/types";
import { createSelector } from "@reduxjs/toolkit";
import { useSelector } from "react-redux";
import type { RootState } from "../store";

/**
 * Statistics computed from extraction results
 */
export interface ExtractionResultsStats {
  totalResults: number;
  acceptedCount: number;
  rejectedCount: number;
  editedCount: number;
  pendingCount: number;
  averageConfidence: number;
}

/**
 * Return type for useExtractionResultsForJob hook
 */
export interface UseExtractionResultsForJobReturn {
  /** Array of extraction results for the job (from store) */
  results: ExtractionResult[];
  /** Computed statistics for the results */
  stats: ExtractionResultsStats;
  /** Results filtered by pending status */
  pendingResults: ExtractionResult[];
  /** Results filtered by accepted status */
  acceptedResults: ExtractionResult[];
  /** Results filtered by rejected status */
  rejectedResults: ExtractionResult[];
  /** Results filtered by edited status */
  editedResults: ExtractionResult[];
  /** Whether there are any results */
  hasResults: boolean;
  /** Whether the results array is empty */
  isEmpty: boolean;
}

/**
 * Create a memoized selector for extraction results by job ID
 * This prevents unnecessary re-renders when other parts of the store change
 */
const makeSelectExtractionResultsByJobId = () =>
  createSelector(
    [
      (state: RootState) => state.entities.extractionResults,
      (_state: RootState, jobId: string | null) => jobId
    ],
    (extractionResults, jobId): ExtractionResult[] => {
      if (!jobId) return [];

      // Filter results that belong to this job and sort by page number
      return Object.values(extractionResults)
        .filter((result) => result.extractionJobId === jobId)
        .sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0));
    }
  );

/**
 * Compute statistics from extraction results
 */
function computeStats(results: ExtractionResult[]): ExtractionResultsStats {
  const totalResults = results.length;
  const acceptedCount = results.filter((r) => r.status === "accepted").length;
  const rejectedCount = results.filter((r) => r.status === "rejected").length;
  const editedCount = results.filter((r) => r.status === "edited").length;
  const pendingCount = results.filter((r) => r.status === "pending").length;

  const averageConfidence =
    totalResults > 0
      ? results.reduce((sum, r) => sum + (r.confidenceScore || 0), 0) /
        totalResults
      : 0;

  return {
    totalResults,
    acceptedCount,
    rejectedCount,
    editedCount,
    pendingCount,
    averageConfidence
  };
}

/**
 * Hook to read extraction results for a specific job from the Redux store
 *
 * STORE-FIRST PATTERN: Only reads from store, no fetching
 * Data is fetched and updated via:
 * 1. ExtractionResultRepository.getExtractionResultsByJob() (initial load)
 * 2. ExtractionResultRepository WebSocket subscriptions (realtime updates)
 *
 * @param jobId - The extraction job ID to read results for
 * @returns Object containing results array, stats, and filtered result sets
 *
 * @example
 * const { results, stats, pendingResults } = useExtractionResultsForJob(jobId);
 */
export function useExtractionResultsForJob(
  jobId: string | null
): UseExtractionResultsForJobReturn {
  // Create memoized selector instance
  const selectExtractionResultsByJobId = useMemo(
    () => makeSelectExtractionResultsByJobId(),
    []
  );

  // Read results from store using memoized selector
  const results = useSelector((state: RootState) =>
    selectExtractionResultsByJobId(state, jobId)
  );

  // Compute derived values with memoization
  const stats = useMemo(() => computeStats(results), [results]);

  const pendingResults = useMemo(
    () => results.filter((r) => r.status === "pending"),
    [results]
  );

  const acceptedResults = useMemo(
    () => results.filter((r) => r.status === "accepted"),
    [results]
  );

  const rejectedResults = useMemo(
    () => results.filter((r) => r.status === "rejected"),
    [results]
  );

  const editedResults = useMemo(
    () => results.filter((r) => r.status === "edited"),
    [results]
  );

  return {
    results,
    stats,
    pendingResults,
    acceptedResults,
    rejectedResults,
    editedResults,
    hasResults: results.length > 0,
    isEmpty: results.length === 0
  };
}
