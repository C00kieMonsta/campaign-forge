/**
 * useAppDispatch Hook
 *
 * Type-safe wrapper around Redux's useDispatch hook.
 * Provides access to the dispatch function with proper typing.
 *
 * Requirements: 10.5, 15.4
 */

import { useDispatch } from "react-redux";
import type { AppDispatch } from "../store";

/**
 * Get the typed dispatch function for dispatching actions to the store.
 *
 * @returns The typed dispatch function
 *
 * @example
 * const dispatch = useAppDispatch();
 * dispatch(setSelectedClientId('client-123'));
 */
export function useAppDispatch(): AppDispatch {
  return useDispatch<AppDispatch>();
}
