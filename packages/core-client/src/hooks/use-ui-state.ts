/**
 * useUIState Hook
 *
 * Hook for accessing UI state from the Redux store.
 * Provides access to selections, filters, loading states, and errors.
 *
 * Requirements: 10.4, 15.4, 21.2
 */

import type {
  ErrorsState,
  FiltersState,
  LoadingState,
  SelectionsState,
  UIState
} from "@packages/types";
import { useSelector } from "react-redux";
import type { RootState } from "../store";

/**
 * Access the complete UI state from the store.
 *
 * @returns The complete UI state including selections, filters, loading, and errors
 *
 * @example
 * const { selections, filters, loading, errors } = useUIState();
 */
export function useUIState(): UIState {
  return useSelector((state: RootState) => state.ui);
}

/**
 * Access only the selections state from the UI slice.
 *
 * @returns The selections state
 *
 * @example
 * const { selectedClientId, selectedProjectId } = useSelections();
 */
export function useSelections(): SelectionsState {
  return useSelector((state: RootState) => state.ui.selections);
}

/**
 * Access only the filters state from the UI slice.
 *
 * @returns The filters state
 *
 * @example
 * const { clientSearch, projectStatus } = useFilters();
 */
export function useFilters(): FiltersState {
  return useSelector((state: RootState) => state.ui.filters);
}

/**
 * Access only the loading state from the UI slice.
 *
 * @returns The loading state
 *
 * @example
 * const { clients: clientsLoading, projects: projectsLoading } = useLoadingState();
 */
export function useLoadingState(): LoadingState {
  return useSelector((state: RootState) => state.ui.loading);
}

/**
 * Access only the errors state from the UI slice.
 *
 * @returns The errors state
 *
 * @example
 * const { clients: clientsError, projects: projectsError } = useErrorsState();
 */
export function useErrorsState(): ErrorsState {
  return useSelector((state: RootState) => state.ui.errors);
}
