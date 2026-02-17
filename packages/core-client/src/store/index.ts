/**
 * Store Module
 *
 * Exports Redux store configuration, slices, and types for the store-first architecture.
 * This is the main entry point for accessing store functionality.
 *
 * Requirements: 8.5, 16.3, 16.5
 */

// Export store configuration and types
export { createAppStore, store } from "./store";
export type { RootState, AppDispatch } from "./store";

// Export all slice actions
export {
  // Client actions
  setClient,
  setClients,
  updateClient,
  removeClient,
  // Project actions
  setProject,
  setProjects,
  updateProject,
  removeProject,
  // ExtractionJob actions
  setExtractionJob,
  setExtractionJobs,
  updateExtractionJob,
  removeExtractionJob,
  // ExtractionResult actions
  setExtractionResult,
  setExtractionResults,
  updateExtractionResult,
  removeExtractionResult,
  // ExtractionSchema actions
  setExtractionSchema,
  setExtractionSchemas,
  updateExtractionSchema,
  removeExtractionSchema,
  // Supplier actions
  setSupplier,
  setSuppliers,
  updateSupplier,
  removeSupplier,
  // Batch operations
  clearAllEntities
} from "./slices/entities-slice";

export {
  // Selection actions
  setSelectedClientId,
  setSelectedProjectId,
  setSelectedJobId,
  setSelectedSupplierId,
  clearSelections,
  // Filter actions
  setClientSearch,
  setProjectStatusFilter,
  setJobStatusFilter,
  setDateRangeFilter,
  clearFilters,
  // Loading state actions
  setClientsLoading,
  setProjectsLoading,
  setJobsLoading,
  setResultsLoading,
  setSchemasLoading,
  setSuppliersLoading,
  clearAllLoading,
  // Error state actions
  setClientsError,
  setProjectsError,
  setJobsError,
  setResultsError,
  setSchemasError,
  setSuppliersError,
  clearAllErrors,
  // Reset
  resetUIState
} from "./slices/ui-slice";

export {
  // New entity draft actions
  setNewClientDraft,
  updateNewClientDraft,
  clearNewClientDraft,
  setNewProjectDraft,
  updateNewProjectDraft,
  clearNewProjectDraft,
  setNewSupplierDraft,
  updateNewSupplierDraft,
  clearNewSupplierDraft,
  // Editing entity draft actions
  setEditingClientDraft,
  updateEditingClientDraft,
  clearEditingClientDraft,
  setEditingProjectDraft,
  updateEditingProjectDraft,
  clearEditingProjectDraft,
  setEditingSupplierDraft,
  updateEditingSupplierDraft,
  clearEditingSupplierDraft,
  // Clear all
  clearAllDrafts
} from "./slices/drafts-slice";

export {
  setTheme,
  setSidebarCollapsed,
  toggleSidebar,
  setDefaultPageSize,
  setDefaultView,
  setPersistedSelectedClientId,
  resetPreferences
} from "./slices/preferences-slice";

// Export selectors
export * from "./selectors";

// Export slice reducers for testing
export { default as entitiesReducer } from "./slices/entities-slice";
export { default as uiReducer } from "./slices/ui-slice";
export { default as draftsReducer } from "./slices/drafts-slice";
export { default as preferencesReducer } from "./slices/preferences-slice";
