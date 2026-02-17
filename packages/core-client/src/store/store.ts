/**
 * Redux Store Configuration
 *
 * Configures the Redux store with Redux Toolkit, combining all slices
 * and enabling Redux DevTools integration.
 *
 * Requirements: 1.1, 1.2, 8.1, 8.2, 8.3, 8.4, 8.5, 14.1, 14.2, 14.3, 14.4, 14.5
 */

import type { AppState } from "@packages/types";
import { configureStore } from "@reduxjs/toolkit";
import draftsReducer from "./slices/drafts-slice";
import entitiesReducer from "./slices/entities-slice";
import preferencesReducer from "./slices/preferences-slice";
import uiReducer from "./slices/ui-slice";

/**
 * Configure and create the Redux store with all slices
 *
 * The store uses Redux Toolkit's configureStore which automatically:
 * - Sets up Redux DevTools integration
 * - Adds thunk middleware
 * - Enables Immer for immutable updates
 * - Adds development-mode checks for common mistakes
 */
export function createAppStore() {
  return configureStore({
    reducer: {
      entities: entitiesReducer,
      ui: uiReducer,
      drafts: draftsReducer,
      preferences: preferencesReducer
    },
    // Enable Redux DevTools in development
    devTools: process.env.NODE_ENV !== "production"
    // Middleware is automatically configured by Redux Toolkit
    // Includes thunk and development checks
  });
}

/**
 * Create the default store instance
 */
export const store = createAppStore();

/**
 * Infer the `RootState` type from the store itself
 */
export type RootState = ReturnType<typeof store.getState>;

/**
 * Infer the `AppDispatch` type from the store itself
 */
export type AppDispatch = typeof store.dispatch;

/**
 * Type guard to ensure RootState matches AppState from types package
 */
const _typeCheck: AppState = {} as RootState;
