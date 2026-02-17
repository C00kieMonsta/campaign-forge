/**
 * Store State Type Definitions
 *
 * This module defines the complete application state structure for the store-first architecture.
 * All application state lives in a single Redux store with clearly defined slices.
 */

import type { Client } from "../entities/client";
import type { DataLayer } from "../entities/data_layer";
import type { ExtractionJob } from "../entities/extraction_job";
import type { ExtractionResult } from "../entities/extraction_result";
import type { ExtractionSchema } from "../entities/extraction_schema";
import type { Invitation } from "../entities/invitation";
import type { OrganizationMember } from "../entities/organization_member";
import type { Project } from "../entities/project";
import type { Supplier } from "../entities/supplier";
import type { SupplierMatch } from "../entities/supplier_match";

/**
 * Root application state structure
 * Contains all slices: entities, ui, drafts, and preferences
 */
export interface AppState {
  entities: EntitiesState;
  ui: UIState;
  drafts: DraftsState;
  preferences: PreferencesState;
}

/**
 * Entities slice - normalized storage of all domain entities
 * Entities are stored by ID in Record<string, Entity> structures to prevent duplication
 * and enable efficient updates. Relationships are represented by ID references.
 */
export interface EntitiesState {
  clients: Record<string, Client>;
  projects: Record<string, Project>;
  dataLayers: Record<string, DataLayer>;
  extractionJobs: Record<string, ExtractionJob>;
  extractionResults: Record<string, ExtractionResult>;
  extractionSchemas: Record<string, ExtractionSchema>;
  suppliers: Record<string, Supplier>;
  organizationMembers: Record<string, OrganizationMember>;
  invitations: Record<string, Invitation>;
  supplierMatches: Record<string, SupplierMatch>;
}

/**
 * UI slice - ephemeral UI state including selections, filters, and loading states
 * This state is not persisted and resets on page reload
 */
export interface UIState {
  selections: SelectionsState;
  filters: FiltersState;
  loading: LoadingState;
  errors: ErrorsState;
}

/**
 * User selections across the application
 */
export interface SelectionsState {
  selectedClientId: string | null;
  selectedProjectId: string | null;
  selectedJobId: string | null;
  selectedSupplierId: string | null;
}

/**
 * Active filters for various entity lists
 */
export interface FiltersState {
  clientSearch: string;
  projectStatus: string[];
  jobStatus: string[];
  dateRange: {
    start: Date | null;
    end: Date | null;
  };
}

/**
 * Loading states for async operations
 */
export interface LoadingState {
  clients: boolean;
  projects: boolean;
  jobs: boolean;
  results: boolean;
  schemas: boolean;
  suppliers: boolean;
  organizationMembers: boolean;
  invitations: boolean;
  supplierMatches: boolean;
}

/**
 * Error states for failed operations
 */
export interface ErrorsState {
  clients: string | null;
  projects: string | null;
  jobs: string | null;
  results: string | null;
  schemas: string | null;
  suppliers: string | null;
  organizationMembers: string | null;
  invitations: string | null;
  supplierMatches: string | null;
}

/**
 * Drafts slice - unsaved form data for optimistic updates and form state
 * Allows users to work on forms without immediately persisting changes
 */
export interface DraftsState {
  newClient: Partial<Client> | null;
  newProject: Partial<Project> | null;
  newSupplier: Partial<Supplier> | null;
  editingClient: { id: string; draft: Partial<Client> } | null;
  editingProject: { id: string; draft: Partial<Project> } | null;
  editingSupplier: { id: string; draft: Partial<Supplier> } | null;
}

/**
 * Preferences slice - user settings and preferences
 * This state is typically persisted to localStorage
 */
export interface PreferencesState {
  theme: "light" | "dark" | "system";
  sidebarCollapsed: boolean;
  defaultPageSize: number;
  defaultView: "list" | "grid" | "table";
  /**
   * Persisted selected client ID
   * This is stored in preferences (localStorage) to survive page reloads
   * The UI slice also has selectedClientId for runtime state
   */
  selectedClientId: string | null;
}
