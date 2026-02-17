/**
 * Collection Selectors
 *
 * Selectors for accessing filtered and sorted collections of entities.
 * These selectors apply filters and transformations to entity collections.
 *
 * Requirements: 2.4, 2.5, 15.4
 */

import type {
  Client,
  ExtractionJob,
  ExtractionResult,
  Project,
  Supplier
} from "@packages/types";
import type { RootState } from "../store";

/**
 * Select clients filtered by search term
 * Searches in client name, contact name, and contact email
 * @param state - Root Redux state
 * @param searchTerm - Search term to filter by
 * @returns Filtered array of client entities
 */
export const selectClientsBySearch = (
  state: RootState,
  searchTerm: string
): Client[] => {
  const clients = Object.values(state.entities.clients);
  if (!searchTerm) return clients;

  const term = searchTerm.toLowerCase();
  return clients.filter(
    (client) =>
      client.name.toLowerCase().includes(term) ||
      client.contactName?.toLowerCase().includes(term) ||
      client.contactEmail?.toLowerCase().includes(term)
  );
};

/**
 * Select projects filtered by status
 * @param state - Root Redux state
 * @param statuses - Array of status values to filter by
 * @returns Filtered array of project entities
 */
export const selectProjectsByStatus = (
  state: RootState,
  statuses: string[]
): Project[] => {
  const projects = Object.values(state.entities.projects);
  if (!statuses || statuses.length === 0) return projects;

  return projects.filter((project) => statuses.includes(project.status));
};

/**
 * Select projects filtered by client ID
 * @param state - Root Redux state
 * @param clientId - Client ID to filter by
 * @returns Filtered array of project entities
 */
export const selectProjectsByClientId = (
  state: RootState,
  clientId: string
): Project[] => {
  const projects = Object.values(state.entities.projects);
  return projects.filter((project) => project.clientId === clientId);
};

/**
 * Select extraction jobs filtered by status
 * @param state - Root Redux state
 * @param statuses - Array of status values to filter by
 * @returns Filtered array of extraction job entities
 */
export const selectExtractionJobsByStatus = (
  state: RootState,
  statuses: string[]
): ExtractionJob[] => {
  const jobs = Object.values(state.entities.extractionJobs);
  if (!statuses || statuses.length === 0) return jobs;

  return jobs.filter((job) => statuses.includes(job.status));
};

/**
 * Select extraction jobs filtered by schema ID
 * @param state - Root Redux state
 * @param schemaId - Schema ID to filter by
 * @returns Filtered array of extraction job entities
 */
export const selectExtractionJobsBySchemaId = (
  state: RootState,
  schemaId: string
): ExtractionJob[] => {
  const jobs = Object.values(state.entities.extractionJobs);
  return jobs.filter((job) => job.schemaId === schemaId);
};

/**
 * Select extraction results filtered by job ID
 * @param state - Root Redux state
 * @param jobId - Extraction job ID to filter by
 * @returns Filtered array of extraction result entities
 */
export const selectExtractionResultsByJobId = (
  state: RootState,
  jobId: string
): ExtractionResult[] => {
  const results = Object.values(state.entities.extractionResults);
  return results.filter((result) => result.extractionJobId === jobId);
};

/**
 * Select extraction results filtered by status
 * @param state - Root Redux state
 * @param statuses - Array of status values to filter by
 * @returns Filtered array of extraction result entities
 */
export const selectExtractionResultsByStatus = (
  state: RootState,
  statuses: Array<"pending" | "accepted" | "rejected" | "edited">
): ExtractionResult[] => {
  const results = Object.values(state.entities.extractionResults);
  if (!statuses || statuses.length === 0) return results;

  return results.filter((result) => statuses.includes(result.status));
};

/**
 * Select suppliers filtered by search term
 * Searches in supplier name
 * @param state - Root Redux state
 * @param searchTerm - Search term to filter by
 * @returns Filtered array of supplier entities
 */
export const selectSuppliersBySearch = (
  state: RootState,
  searchTerm: string
): Supplier[] => {
  const suppliers = Object.values(state.entities.suppliers);
  if (!searchTerm) return suppliers;

  const term = searchTerm.toLowerCase();
  return suppliers.filter((supplier) =>
    supplier.name.toLowerCase().includes(term)
  );
};

/**
 * Select projects filtered by date range
 * @param state - Root Redux state
 * @param startDate - Start date of range (inclusive)
 * @param endDate - End date of range (inclusive)
 * @returns Filtered array of project entities
 */
export const selectProjectsByDateRange = (
  state: RootState,
  startDate: Date | null,
  endDate: Date | null
): Project[] => {
  const projects = Object.values(state.entities.projects);

  if (!startDate && !endDate) return projects;

  return projects.filter((project) => {
    const createdAt = new Date(project.createdAt);

    if (startDate && createdAt < startDate) return false;
    if (endDate && createdAt > endDate) return false;

    return true;
  });
};

/**
 * Select extraction jobs filtered by date range
 * @param state - Root Redux state
 * @param startDate - Start date of range (inclusive)
 * @param endDate - End date of range (inclusive)
 * @returns Filtered array of extraction job entities
 */
export const selectExtractionJobsByDateRange = (
  state: RootState,
  startDate: Date | null,
  endDate: Date | null
): ExtractionJob[] => {
  const jobs = Object.values(state.entities.extractionJobs);

  if (!startDate && !endDate) return jobs;

  return jobs.filter((job) => {
    const createdAt = new Date(job.createdAt);

    if (startDate && createdAt < startDate) return false;
    if (endDate && createdAt > endDate) return false;

    return true;
  });
};

/**
 * Select active extraction jobs (not completed or failed)
 * @param state - Root Redux state
 * @returns Filtered array of active extraction job entities
 */
export const selectActiveExtractionJobs = (
  state: RootState
): ExtractionJob[] => {
  const jobs = Object.values(state.entities.extractionJobs);
  return jobs.filter(
    (job) => job.status !== "completed" && job.status !== "failed"
  );
};

/**
 * Select completed extraction jobs
 * @param state - Root Redux state
 * @returns Filtered array of completed extraction job entities
 */
export const selectCompletedExtractionJobs = (
  state: RootState
): ExtractionJob[] => {
  const jobs = Object.values(state.entities.extractionJobs);
  return jobs.filter((job) => job.status === "completed");
};
