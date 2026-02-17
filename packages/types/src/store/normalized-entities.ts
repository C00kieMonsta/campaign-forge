/**
 * Normalized Entity Types
 *
 * These types represent entities in their normalized form for store storage.
 * Instead of nested objects, relationships are represented by ID references.
 * This prevents data duplication and enables efficient updates.
 */

import type { Client } from "../entities/client";
import type { ExtractionJob } from "../entities/extraction_job";
import type { ExtractionResult } from "../entities/extraction_result";
import type { Project } from "../entities/project";

/**
 * Normalized Client entity
 * Stores project IDs instead of nested project objects
 */
export interface NormalizedClient extends Omit<Client, "projects"> {
  projectIds: string[];
}

/**
 * Normalized Project entity
 * Stores client ID and extraction job IDs instead of nested objects
 */
export interface NormalizedProject
  extends Omit<Project, "client" | "extractionJobs"> {
  clientId: string;
  extractionJobIds: string[];
}

/**
 * Normalized ExtractionJob entity
 * Stores project ID and extraction result IDs instead of nested objects
 */
export interface NormalizedExtractionJob
  extends Omit<ExtractionJob, "project" | "extractionResults"> {
  projectId: string;
  extractionResultIds: string[];
}

/**
 * Normalized ExtractionResult entity
 * Stores job ID instead of nested job object
 */
export interface NormalizedExtractionResult
  extends Omit<ExtractionResult, "extractionJob"> {
  extractionJobId: string;
}

/**
 * Helper type to extract entity ID type
 */
export type EntityId = string;

/**
 * Helper type for entity collections in the store
 */
export type EntityCollection<T extends { id: string }> = Record<EntityId, T>;

/**
 * Entity type discriminator for type-safe entity access
 */
export type EntityType =
  | "clients"
  | "projects"
  | "extractionJobs"
  | "extractionResults"
  | "extractionSchemas"
  | "suppliers";

/**
 * Map entity type to entity interface
 */
export interface EntityTypeMap {
  clients: Client;
  projects: Project;
  extractionJobs: ExtractionJob;
  extractionResults: ExtractionResult;
  extractionSchemas: import("../entities/extraction_schema").ExtractionSchema;
  suppliers: import("../entities/supplier").Supplier;
}
