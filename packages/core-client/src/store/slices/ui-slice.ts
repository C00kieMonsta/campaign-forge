/**
 * UI Slice
 *
 * Manages ephemeral UI state including selections, filters, and loading states.
 * This state is not persisted and resets on page reload.
 *
 * Requirements: 8.2, 14.1, 14.2
 */

import type { UIState } from "@packages/types";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

/**
 * Initial UI state with no selections, empty filters, and no loading/error states
 */
const initialState: UIState = {
  selections: {
    selectedClientId: null,
    selectedProjectId: null,
    selectedJobId: null,
    selectedSupplierId: null
  },
  filters: {
    clientSearch: "",
    projectStatus: [],
    jobStatus: [],
    dateRange: {
      start: null,
      end: null
    }
  },
  loading: {
    clients: false,
    projects: false,
    jobs: false,
    results: false,
    schemas: false,
    suppliers: false,
    organizationMembers: false,
    invitations: false,
    supplierMatches: false
  },
  errors: {
    clients: null,
    projects: null,
    jobs: null,
    results: null,
    schemas: null,
    suppliers: null,
    organizationMembers: null,
    invitations: null,
    supplierMatches: null
  }
};

/**
 * UI slice with actions for managing selections, filters, loading, and error states
 */
const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    // Selection actions
    setSelectedClientId: (state, action: PayloadAction<string | null>) => {
      state.selections.selectedClientId = action.payload;
    },
    setSelectedProjectId: (state, action: PayloadAction<string | null>) => {
      state.selections.selectedProjectId = action.payload;
    },
    setSelectedJobId: (state, action: PayloadAction<string | null>) => {
      state.selections.selectedJobId = action.payload;
    },
    setSelectedSupplierId: (state, action: PayloadAction<string | null>) => {
      state.selections.selectedSupplierId = action.payload;
    },
    clearSelections: (state) => {
      state.selections = {
        selectedClientId: null,
        selectedProjectId: null,
        selectedJobId: null,
        selectedSupplierId: null
      };
    },

    // Filter actions
    setClientSearch: (state, action: PayloadAction<string>) => {
      state.filters.clientSearch = action.payload;
    },
    setProjectStatusFilter: (state, action: PayloadAction<string[]>) => {
      state.filters.projectStatus = action.payload;
    },
    setJobStatusFilter: (state, action: PayloadAction<string[]>) => {
      state.filters.jobStatus = action.payload;
    },
    setDateRangeFilter: (
      state,
      action: PayloadAction<{ start: Date | null; end: Date | null }>
    ) => {
      state.filters.dateRange = action.payload;
    },
    clearFilters: (state) => {
      state.filters = {
        clientSearch: "",
        projectStatus: [],
        jobStatus: [],
        dateRange: {
          start: null,
          end: null
        }
      };
    },

    // Loading state actions
    setClientsLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.clients = action.payload;
    },
    setProjectsLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.projects = action.payload;
    },
    setJobsLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.jobs = action.payload;
    },
    setResultsLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.results = action.payload;
    },
    setSchemasLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.schemas = action.payload;
    },
    setSuppliersLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.suppliers = action.payload;
    },
    setOrganizationMembersLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.organizationMembers = action.payload;
    },
    setInvitationsLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.invitations = action.payload;
    },
    setSupplierMatchesLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.supplierMatches = action.payload;
    },
    clearAllLoading: (state) => {
      state.loading = {
        clients: false,
        projects: false,
        jobs: false,
        results: false,
        schemas: false,
        suppliers: false,
        organizationMembers: false,
        invitations: false,
        supplierMatches: false
      };
    },

    // Error state actions
    setClientsError: (state, action: PayloadAction<string | null>) => {
      state.errors.clients = action.payload;
    },
    setProjectsError: (state, action: PayloadAction<string | null>) => {
      state.errors.projects = action.payload;
    },
    setJobsError: (state, action: PayloadAction<string | null>) => {
      state.errors.jobs = action.payload;
    },
    setResultsError: (state, action: PayloadAction<string | null>) => {
      state.errors.results = action.payload;
    },
    setSchemasError: (state, action: PayloadAction<string | null>) => {
      state.errors.schemas = action.payload;
    },
    setSuppliersError: (state, action: PayloadAction<string | null>) => {
      state.errors.suppliers = action.payload;
    },
    setOrganizationMembersError: (state, action: PayloadAction<string | null>) => {
      state.errors.organizationMembers = action.payload;
    },
    setInvitationsError: (state, action: PayloadAction<string | null>) => {
      state.errors.invitations = action.payload;
    },
    setSupplierMatchesError: (state, action: PayloadAction<string | null>) => {
      state.errors.supplierMatches = action.payload;
    },
    clearAllErrors: (state) => {
      state.errors = {
        clients: null,
        projects: null,
        jobs: null,
        results: null,
        schemas: null,
        suppliers: null,
        organizationMembers: null,
        invitations: null,
        supplierMatches: null
      };
    },

    // Reset entire UI state
    resetUIState: () => initialState
  }
});

export const {
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
  setOrganizationMembersLoading,
  setInvitationsLoading,
  setSupplierMatchesLoading,
  clearAllLoading,
  // Error state actions
  setClientsError,
  setProjectsError,
  setJobsError,
  setResultsError,
  setSchemasError,
  setSuppliersError,
  setOrganizationMembersError,
  setInvitationsError,
  setSupplierMatchesError,
  clearAllErrors,
  // Reset
  resetUIState
} = uiSlice.actions;

export default uiSlice.reducer;
