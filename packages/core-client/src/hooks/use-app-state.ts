/**
 * useAppState Hook
 *
 * Generic hook for selecting state from the Redux store with type safety.
 * Re-renders only when the selected state changes.
 *
 * Requirements: 10.1, 15.4, 21.2, 21.3
 */

import { useSelector } from "react-redux";
import type { RootState } from "../store";

/**
 * Select state from the Redux store using a selector function.
 * The component will only re-render when the selected state changes.
 *
 * @param selector - Function that extracts the desired state from RootState
 * @returns The selected state
 *
 * @example
 * // Select a specific piece of state
 * const clients = useAppState(state => state.entities.clients);
 *
 * @example
 * // Use with existing selectors
 * const selectedClient = useAppState(selectSelectedClient);
 */
export function useAppState<T>(selector: (state: RootState) => T): T {
  return useSelector(selector);
}
