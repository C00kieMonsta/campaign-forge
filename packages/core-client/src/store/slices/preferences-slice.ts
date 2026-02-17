/**
 * Preferences Slice
 *
 * Manages user settings and preferences.
 * This state is typically persisted to localStorage.
 *
 * Requirements: 8.4, 14.1, 14.2
 */

import type { PreferencesState } from "@packages/types";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

/**
 * Load initial preferences from localStorage if available
 */
function loadInitialPreferences(): PreferencesState {
  const defaults: PreferencesState = {
    theme: "system",
    sidebarCollapsed: false,
    defaultPageSize: 20,
    defaultView: "list",
    selectedClientId: null
  };

  if (typeof window === "undefined") {
    return defaults;
  }

  try {
    // Load selectedClientId from localStorage for persistence across page reloads
    const savedClientId = localStorage.getItem("selectedClientId");
    if (savedClientId) {
      defaults.selectedClientId = savedClientId;
    }
  } catch {
    // Ignore localStorage errors (e.g., in SSR or private browsing)
  }

  return defaults;
}

/**
 * Initial preferences state with sensible defaults
 */
const initialState: PreferencesState = loadInitialPreferences();

/**
 * Preferences slice with actions for managing user settings
 */
const preferencesSlice = createSlice({
  name: "preferences",
  initialState,
  reducers: {
    setTheme: (state, action: PayloadAction<"light" | "dark" | "system">) => {
      state.theme = action.payload;
    },
    setSidebarCollapsed: (state, action: PayloadAction<boolean>) => {
      state.sidebarCollapsed = action.payload;
    },
    toggleSidebar: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setDefaultPageSize: (state, action: PayloadAction<number>) => {
      state.defaultPageSize = action.payload;
    },
    setDefaultView: (
      state,
      action: PayloadAction<"list" | "grid" | "table">
    ) => {
      state.defaultView = action.payload;
    },
    /**
     * Set the selected client ID and persist to localStorage
     * This is the persisted version - UI slice has the runtime version
     */
    setPersistedSelectedClientId: (
      state,
      action: PayloadAction<string | null>
    ) => {
      state.selectedClientId = action.payload;
      // Persist to localStorage
      if (typeof window !== "undefined") {
        if (action.payload) {
          localStorage.setItem("selectedClientId", action.payload);
        } else {
          localStorage.removeItem("selectedClientId");
        }
      }
    },
    resetPreferences: () => {
      // Clear localStorage when resetting
      if (typeof window !== "undefined") {
        localStorage.removeItem("selectedClientId");
      }
      return loadInitialPreferences();
    }
  }
});

export const {
  setTheme,
  setSidebarCollapsed,
  toggleSidebar,
  setDefaultPageSize,
  setDefaultView,
  setPersistedSelectedClientId,
  resetPreferences
} = preferencesSlice.actions;

export default preferencesSlice.reducer;
