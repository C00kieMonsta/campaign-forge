import { useCollection } from "@packages/core-client";
import type { ExtractionJob } from "@packages/types";

/**
 * useExtractionJobs
 *
 * Get all extraction jobs from Redux store
 * Data is fetched at the app level via useAppDataOrchestrator
 *
 * Returns array of extraction jobs (empty array if none)
 *
 * @example
 * const jobs = useExtractionJobs();
 * const completedJobs = jobs.filter(j => j.status === "completed");
 */
export function useExtractionJobs(): ExtractionJob[] {
  return useCollection("extractionJobs");
}
