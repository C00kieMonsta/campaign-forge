/**
 * Relationship Selectors
 *
 * Selectors for accessing entities through their relationships.
 * These selectors navigate the normalized entity graph using ID references.
 *
 * Requirements: 2.4, 2.5, 15.4
 */

import type {
  Client,
  ExtractionJob,
  ExtractionResult,
  ExtractionSchema,
  Project
} from "@packages/types";
import type { RootState } from "../store";

/**
 * Select all projects for a given client
 * @param state - Root Redux state
 * @param clientId - Client ID
 * @returns Array of project entities belonging to the client
 */
export const selectProjectsForClient = (
  state: RootState,
  clientId: string
): Project[] => {
  const projects = Object.values(state.entities.projects);
  return projects.filter((project) => project.clientId === clientId);
};

/**
 * Select the client for a given project
 * @param state - Root Redux state
 * @param projectId - Project ID
 * @returns Client entity or null if not found
 */
export const selectClientForProject = (
  state: RootState,
  projectId: string
): Client | null => {
  const project = state.entities.projects[projectId];
  if (!project) return null;

  return state.entities.clients[project.clientId] || null;
};

/**
 * Select all extraction jobs for a given schema
 * @param state - Root Redux state
 * @param schemaId - Extraction schema ID
 * @returns Array of extraction job entities using the schema
 */
export const selectJobsForSchema = (
  state: RootState,
  schemaId: string
): ExtractionJob[] => {
  const jobs = Object.values(state.entities.extractionJobs);
  return jobs.filter((job) => job.schemaId === schemaId);
};

/**
 * Select the schema for a given extraction job
 * @param state - Root Redux state
 * @param jobId - Extraction job ID
 * @returns ExtractionSchema entity or null if not found
 */
export const selectSchemaForJob = (
  state: RootState,
  jobId: string
): ExtractionSchema | null => {
  const job = state.entities.extractionJobs[jobId];
  if (!job) return null;

  return state.entities.extractionSchemas[job.schemaId] || null;
};

/**
 * Select all extraction results for a given job
 * @param state - Root Redux state
 * @param jobId - Extraction job ID
 * @returns Array of extraction result entities for the job
 */
export const selectResultsForJob = (
  state: RootState,
  jobId: string
): ExtractionResult[] => {
  const results = Object.values(state.entities.extractionResults);
  return results.filter((result) => result.extractionJobId === jobId);
};

/**
 * Select the job for a given extraction result
 * @param state - Root Redux state
 * @param resultId - Extraction result ID
 * @returns ExtractionJob entity or null if not found
 */
export const selectJobForResult = (
  state: RootState,
  resultId: string
): ExtractionJob | null => {
  const result = state.entities.extractionResults[resultId];
  if (!result) return null;

  return state.entities.extractionJobs[result.extractionJobId] || null;
};

/**
 * Select project with its client relationship populated
 * @param state - Root Redux state
 * @param projectId - Project ID
 * @returns Project with client or null if project not found
 */
export const selectProjectWithClient = (
  state: RootState,
  projectId: string
): (Project & { client: Client | null }) | null => {
  const project = state.entities.projects[projectId];
  if (!project) return null;

  const client = state.entities.clients[project.clientId] || null;

  return {
    ...project,
    client
  };
};

/**
 * Select extraction job with its schema relationship populated
 * @param state - Root Redux state
 * @param jobId - Extraction job ID
 * @returns ExtractionJob with schema or null if job not found
 */
export const selectJobWithSchema = (
  state: RootState,
  jobId: string
): (ExtractionJob & { schema: ExtractionSchema | null }) | null => {
  const job = state.entities.extractionJobs[jobId];
  if (!job) return null;

  const schema = state.entities.extractionSchemas[job.schemaId] || null;

  return {
    ...job,
    schema
  };
};

/**
 * Select extraction result with its job relationship populated
 * @param state - Root Redux state
 * @param resultId - Extraction result ID
 * @returns ExtractionResult with job or null if result not found
 */
export const selectResultWithJob = (
  state: RootState,
  resultId: string
): (ExtractionResult & { job: ExtractionJob | null }) | null => {
  const result = state.entities.extractionResults[resultId];
  if (!result) return null;

  const job = state.entities.extractionJobs[result.extractionJobId] || null;

  return {
    ...result,
    job
  };
};

/**
 * Select client with all its projects
 * @param state - Root Redux state
 * @param clientId - Client ID
 * @returns Client with projects array or null if client not found
 */
export const selectClientWithProjects = (
  state: RootState,
  clientId: string
): (Client & { projects: Project[] }) | null => {
  const client = state.entities.clients[clientId];
  if (!client) return null;

  const projects = Object.values(state.entities.projects).filter(
    (project) => project.clientId === clientId
  );

  return {
    ...client,
    projects
  };
};

/**
 * Select extraction job with all its results
 * @param state - Root Redux state
 * @param jobId - Extraction job ID
 * @returns ExtractionJob with results array or null if job not found
 */
export const selectJobWithResults = (
  state: RootState,
  jobId: string
): (ExtractionJob & { results: ExtractionResult[] }) | null => {
  const job = state.entities.extractionJobs[jobId];
  if (!job) return null;

  const results = Object.values(state.entities.extractionResults).filter(
    (result) => result.extractionJobId === jobId
  );

  return {
    ...job,
    results
  };
};

/**
 * Select count of projects for a client
 * @param state - Root Redux state
 * @param clientId - Client ID
 * @returns Number of projects for the client
 */
export const selectProjectCountForClient = (
  state: RootState,
  clientId: string
): number => {
  const projects = Object.values(state.entities.projects);
  return projects.filter((project) => project.clientId === clientId).length;
};

/**
 * Select count of results for a job
 * @param state - Root Redux state
 * @param jobId - Extraction job ID
 * @returns Number of results for the job
 */
export const selectResultCountForJob = (
  state: RootState,
  jobId: string
): number => {
  const results = Object.values(state.entities.extractionResults);
  return results.filter((result) => result.extractionJobId === jobId).length;
};

/**
 * Select count of jobs for a schema
 * @param state - Root Redux state
 * @param schemaId - Extraction schema ID
 * @returns Number of jobs using the schema
 */
export const selectJobCountForSchema = (
  state: RootState,
  schemaId: string
): number => {
  const jobs = Object.values(state.entities.extractionJobs);
  return jobs.filter((job) => job.schemaId === schemaId).length;
};
