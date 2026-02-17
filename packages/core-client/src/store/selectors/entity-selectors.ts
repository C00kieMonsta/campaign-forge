/**
 * Entity Selectors
 *
 * Selectors for accessing individual entities by ID from the normalized store.
 * These selectors provide type-safe access to entities and return null if not found.
 *
 * Requirements: 2.4, 2.5, 15.4
 */

import type {
  Client,
  ExtractionJob,
  ExtractionResult,
  ExtractionSchema,
  Project,
  Supplier
} from "@packages/types";
import type { RootState } from "../store";

/**
 * Select a client by ID
 * @param state - Root Redux state
 * @param id - Client ID
 * @returns Client entity or null if not found
 */
export const selectClientById = (
  state: RootState,
  id: string
): Client | null => {
  return state.entities.clients[id] || null;
};

/**
 * Select a project by ID
 * @param state - Root Redux state
 * @param id - Project ID
 * @returns Project entity or null if not found
 */
export const selectProjectById = (
  state: RootState,
  id: string
): Project | null => {
  return state.entities.projects[id] || null;
};

/**
 * Select an extraction job by ID
 * @param state - Root Redux state
 * @param id - Extraction job ID
 * @returns ExtractionJob entity or null if not found
 */
export const selectExtractionJobById = (
  state: RootState,
  id: string
): ExtractionJob | null => {
  return state.entities.extractionJobs[id] || null;
};

/**
 * Select an extraction result by ID
 * @param state - Root Redux state
 * @param id - Extraction result ID
 * @returns ExtractionResult entity or null if not found
 */
export const selectExtractionResultById = (
  state: RootState,
  id: string
): ExtractionResult | null => {
  return state.entities.extractionResults[id] || null;
};

/**
 * Select an extraction schema by ID
 * @param state - Root Redux state
 * @param id - Extraction schema ID
 * @returns ExtractionSchema entity or null if not found
 */
export const selectExtractionSchemaById = (
  state: RootState,
  id: string
): ExtractionSchema | null => {
  return state.entities.extractionSchemas[id] || null;
};

/**
 * Select a supplier by ID
 * @param state - Root Redux state
 * @param id - Supplier ID
 * @returns Supplier entity or null if not found
 */
export const selectSupplierById = (
  state: RootState,
  id: string
): Supplier | null => {
  return state.entities.suppliers[id] || null;
};

/**
 * Select all clients as an array
 * @param state - Root Redux state
 * @returns Array of all client entities
 */
export const selectAllClients = (state: RootState): Client[] => {
  return Object.values(state.entities.clients);
};

/**
 * Select all projects as an array
 * @param state - Root Redux state
 * @returns Array of all project entities
 */
export const selectAllProjects = (state: RootState): Project[] => {
  return Object.values(state.entities.projects);
};

/**
 * Select all extraction jobs as an array
 * @param state - Root Redux state
 * @returns Array of all extraction job entities
 */
export const selectAllExtractionJobs = (state: RootState): ExtractionJob[] => {
  return Object.values(state.entities.extractionJobs);
};

/**
 * Select all extraction results as an array
 * @param state - Root Redux state
 * @returns Array of all extraction result entities
 */
export const selectAllExtractionResults = (
  state: RootState
): ExtractionResult[] => {
  return Object.values(state.entities.extractionResults);
};

/**
 * Select all extraction schemas as an array
 * @param state - Root Redux state
 * @returns Array of all extraction schema entities
 */
export const selectAllExtractionSchemas = (
  state: RootState
): ExtractionSchema[] => {
  return Object.values(state.entities.extractionSchemas);
};

/**
 * Select all suppliers as an array
 * @param state - Root Redux state
 * @returns Array of all supplier entities
 */
export const selectAllSuppliers = (state: RootState): Supplier[] => {
  return Object.values(state.entities.suppliers);
};
