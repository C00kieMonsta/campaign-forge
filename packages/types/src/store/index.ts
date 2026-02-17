/**
 * Store Types Module
 *
 * Exports all store-related type definitions for the store-first architecture.
 * These types define the complete application state structure.
 */

// Export main state interfaces
export type {
  AppState,
  EntitiesState,
  UIState,
  SelectionsState,
  FiltersState,
  LoadingState,
  ErrorsState,
  DraftsState,
  PreferencesState
} from "./app-state";

// Export normalized entity types
export type {
  NormalizedClient,
  NormalizedProject,
  NormalizedExtractionJob,
  NormalizedExtractionResult,
  EntityId,
  EntityCollection,
  EntityType,
  EntityTypeMap
} from "./normalized-entities";
