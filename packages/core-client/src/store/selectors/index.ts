/**
 * Store Selectors
 *
 * Central export point for all selector functions.
 * Selectors provide type-safe access to the Redux store state.
 *
 * Requirements: 2.4, 2.5, 15.4
 */

// Entity selectors - access individual entities by ID
export {
  selectAllClients,
  selectAllExtractionJobs,
  selectAllExtractionResults,
  selectAllExtractionSchemas,
  selectAllProjects,
  selectAllSuppliers,
  selectClientById,
  selectExtractionJobById,
  selectExtractionResultById,
  selectExtractionSchemaById,
  selectProjectById,
  selectSupplierById
} from "./entity-selectors";

// Collection selectors - access filtered collections
export {
  selectActiveExtractionJobs,
  selectClientsBySearch,
  selectCompletedExtractionJobs,
  selectExtractionJobsByDateRange,
  selectExtractionJobsBySchemaId,
  selectExtractionJobsByStatus,
  selectExtractionResultsByJobId,
  selectExtractionResultsByStatus,
  selectProjectsByClientId,
  selectProjectsByDateRange,
  selectProjectsByStatus,
  selectSuppliersBySearch
} from "./collection-selectors";

// Relationship selectors - navigate entity relationships
export {
  selectClientForProject,
  selectClientWithProjects,
  selectJobCountForSchema,
  selectJobForResult,
  selectJobsForSchema,
  selectJobWithResults,
  selectJobWithSchema,
  selectProjectCountForClient,
  selectProjectsForClient,
  selectProjectWithClient,
  selectResultCountForJob,
  selectResultsForJob,
  selectResultWithJob,
  selectSchemaForJob
} from "./relationship-selectors";

// UI state selectors - access UI state
export {
  selectAllErrors,
  selectClientSearchFilter,
  selectClientsError,
  selectClientsLoading,
  selectDateRangeFilter,
  selectErrorsState,
  selectFilters,
  selectHasAnyError,
  selectIsAnyLoading,
  selectJobsError,
  selectJobsLoading,
  selectJobStatusFilter,
  selectLoadingState,
  selectProjectsError,
  selectProjectsLoading,
  selectProjectStatusFilter,
  selectResultsError,
  selectResultsLoading,
  selectSchemasError,
  selectSchemasLoading,
  selectSelectedClient,
  selectSelectedClientId,
  selectSelectedJobId,
  selectSelectedProject,
  selectSelectedProjectId,
  selectSelectedSupplierId,
  selectSelections,
  selectSuppliersError,
  selectSuppliersLoading,
  selectUIState
} from "./ui-selectors";
