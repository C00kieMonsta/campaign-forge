/**
 * React Hooks Module
 *
 * Exports React hooks for accessing the Redux store state and repositories.
 * These hooks provide type-safe access to entities, collections, UI state,
 * and repository operations.
 *
 * Requirements: 3.4, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5, 12.1, 15.4, 21.2, 21.3
 */

// Generic state access hook
export { useAppState } from "./use-app-state";

// Dispatch hook
export { useAppDispatch } from "./use-dispatch";

// Entity access hooks
export { useEntity } from "./use-entity";
export type { EntityType, EntityTypeMap } from "./use-entity";

// Collection access hooks
export {
  useClients,
  useCollection,
  useExtractionJobs,
  useExtractionResults,
  useExtractionSchemas,
  useInvitations,
  useOrganizationMembers,
  useProjects,
  useSuppliers,
  useSupplierMatches
} from "./use-collection";
export type { EntityFilter } from "./use-collection";

// UI state hooks
export {
  useErrorsState,
  useFilters,
  useLoadingState,
  useSelections,
  useUIState
} from "./use-ui-state";

// Repository access hook
export { usePersistence } from "./use-persistence";

// Initialization hook for controlled data orchestration
export { useAppDataOrchestrator } from "./use-app-data-orchestrator";


// Extraction results hook for job-specific data with realtime updates
export { useExtractionResultsForJob } from "./use-extraction-results-for-job";
export type {
  UseExtractionResultsForJobReturn,
  ExtractionResultsStats
} from "./use-extraction-results-for-job";

// Extraction result repository hook for mutations and store-first reading
export { useExtractionResultRepository } from "./use-extraction-result-repository";
export type { UseExtractionResultRepositoryReturn } from "./use-extraction-result-repository";
