/**
 * UI State Selectors
 *
 * Selectors for accessing UI state including selections, filters, loading states, and errors.
 * These selectors provide access to ephemeral UI state that doesn't persist across sessions.
 *
 * Requirements: 2.4, 2.5, 15.4
 */

import type {
  Client,
  ErrorsState,
  FiltersState,
  LoadingState,
  Project,
  SelectionsState
} from "@packages/types";
import type { RootState } from "../store";

/**
 * Select the entire UI state
 * @param state - Root Redux state
 * @returns Complete UI state
 */
export const selectUIState = (state: RootState) => state.ui;

/**
 * Select all selections
 * @param state - Root Redux state
 * @returns Selections state
 */
export const selectSelections = (state: RootState): SelectionsState =>
  state.ui.selections;

/**
 * Select the currently selected client ID
 * @param state - Root Redux state
 * @returns Selected client ID or null
 */
export const selectSelectedClientId = (state: RootState): string | null =>
  state.ui.selections.selectedClientId;

/**
 * Select the currently selected project ID
 * @param state - Root Redux state
 * @returns Selected project ID or null
 */
export const selectSelectedProjectId = (state: RootState): string | null =>
  state.ui.selections.selectedProjectId;

/**
 * Select the currently selected job ID
 * @param state - Root Redux state
 * @returns Selected job ID or null
 */
export const selectSelectedJobId = (state: RootState): string | null =>
  state.ui.selections.selectedJobId;

/**
 * Select the currently selected supplier ID
 * @param state - Root Redux state
 * @returns Selected supplier ID or null
 */
export const selectSelectedSupplierId = (state: RootState): string | null =>
  state.ui.selections.selectedSupplierId;

/**
 * Select the currently selected client entity
 * @param state - Root Redux state
 * @returns Selected client entity or null
 */
export const selectSelectedClient = (state: RootState): Client | null => {
  const clientId = state.ui.selections.selectedClientId;
  return clientId ? state.entities.clients[clientId] || null : null;
};

/**
 * Select the currently selected project entity
 * @param state - Root Redux state
 * @returns Selected project entity or null
 */
export const selectSelectedProject = (state: RootState): Project | null => {
  const projectId = state.ui.selections.selectedProjectId;
  return projectId ? state.entities.projects[projectId] || null : null;
};

/**
 * Select all filters
 * @param state - Root Redux state
 * @returns Filters state
 */
export const selectFilters = (state: RootState): FiltersState =>
  state.ui.filters;

/**
 * Select the client search filter
 * @param state - Root Redux state
 * @returns Client search term
 */
export const selectClientSearchFilter = (state: RootState): string =>
  state.ui.filters.clientSearch;

/**
 * Select the project status filter
 * @param state - Root Redux state
 * @returns Array of selected project statuses
 */
export const selectProjectStatusFilter = (state: RootState): string[] =>
  state.ui.filters.projectStatus;

/**
 * Select the job status filter
 * @param state - Root Redux state
 * @returns Array of selected job statuses
 */
export const selectJobStatusFilter = (state: RootState): string[] =>
  state.ui.filters.jobStatus;

/**
 * Select the date range filter
 * @param state - Root Redux state
 * @returns Date range filter
 */
export const selectDateRangeFilter = (
  state: RootState
): { start: Date | null; end: Date | null } => state.ui.filters.dateRange;

/**
 * Select all loading states
 * @param state - Root Redux state
 * @returns Loading state
 */
export const selectLoadingState = (state: RootState): LoadingState =>
  state.ui.loading;

/**
 * Select whether clients are loading
 * @param state - Root Redux state
 * @returns True if clients are loading
 */
export const selectClientsLoading = (state: RootState): boolean =>
  state.ui.loading.clients;

/**
 * Select whether projects are loading
 * @param state - Root Redux state
 * @returns True if projects are loading
 */
export const selectProjectsLoading = (state: RootState): boolean =>
  state.ui.loading.projects;

/**
 * Select whether jobs are loading
 * @param state - Root Redux state
 * @returns True if jobs are loading
 */
export const selectJobsLoading = (state: RootState): boolean =>
  state.ui.loading.jobs;

/**
 * Select whether results are loading
 * @param state - Root Redux state
 * @returns True if results are loading
 */
export const selectResultsLoading = (state: RootState): boolean =>
  state.ui.loading.results;

/**
 * Select whether schemas are loading
 * @param state - Root Redux state
 * @returns True if schemas are loading
 */
export const selectSchemasLoading = (state: RootState): boolean =>
  state.ui.loading.schemas;

/**
 * Select whether suppliers are loading
 * @param state - Root Redux state
 * @returns True if suppliers are loading
 */
export const selectSuppliersLoading = (state: RootState): boolean =>
  state.ui.loading.suppliers;

/**
 * Select whether any entity is loading
 * @param state - Root Redux state
 * @returns True if any entity is loading
 */
export const selectIsAnyLoading = (state: RootState): boolean => {
  const loading = state.ui.loading;
  return (
    loading.clients ||
    loading.projects ||
    loading.jobs ||
    loading.results ||
    loading.schemas ||
    loading.suppliers
  );
};

/**
 * Select all error states
 * @param state - Root Redux state
 * @returns Errors state
 */
export const selectErrorsState = (state: RootState): ErrorsState =>
  state.ui.errors;

/**
 * Select clients error
 * @param state - Root Redux state
 * @returns Clients error message or null
 */
export const selectClientsError = (state: RootState): string | null =>
  state.ui.errors.clients;

/**
 * Select projects error
 * @param state - Root Redux state
 * @returns Projects error message or null
 */
export const selectProjectsError = (state: RootState): string | null =>
  state.ui.errors.projects;

/**
 * Select jobs error
 * @param state - Root Redux state
 * @returns Jobs error message or null
 */
export const selectJobsError = (state: RootState): string | null =>
  state.ui.errors.jobs;

/**
 * Select results error
 * @param state - Root Redux state
 * @returns Results error message or null
 */
export const selectResultsError = (state: RootState): string | null =>
  state.ui.errors.results;

/**
 * Select schemas error
 * @param state - Root Redux state
 * @returns Schemas error message or null
 */
export const selectSchemasError = (state: RootState): string | null =>
  state.ui.errors.schemas;

/**
 * Select suppliers error
 * @param state - Root Redux state
 * @returns Suppliers error message or null
 */
export const selectSuppliersError = (state: RootState): string | null =>
  state.ui.errors.suppliers;

/**
 * Select whether there are any errors
 * @param state - Root Redux state
 * @returns True if any error exists
 */
export const selectHasAnyError = (state: RootState): boolean => {
  const errors = state.ui.errors;
  return !!(
    errors.clients ||
    errors.projects ||
    errors.jobs ||
    errors.results ||
    errors.schemas ||
    errors.suppliers
  );
};

/**
 * Select all errors as an array of messages
 * @param state - Root Redux state
 * @returns Array of error messages
 */
export const selectAllErrors = (state: RootState): string[] => {
  const errors = state.ui.errors;
  return Object.values(errors).filter((error): error is string => !!error);
};
