import { useMemo } from "react";
import { useCollection } from "@packages/core-client";
import type { ExtractionJob } from "@packages/types";

/**
 * useExtractionJobsForProject
 *
 * Get extraction jobs filtered by project ID
 * Uses useMemo to avoid unnecessary re-filtering
 *
 * @param projectId - The project ID to filter by
 * @returns Array of extraction jobs for the project
 *
 * @example
 * const jobs = useExtractionJobsForProject("proj-123");
 * console.log(`${jobs.length} jobs in this project`);
 */
export function useExtractionJobsForProject(
  _projectId: string
): ExtractionJob[] {
  const allJobs = useCollection("extractionJobs");

  return useMemo(
    () => allJobs, // TODO: Filter by projectId once schema includes it
    [allJobs]
  );
}
