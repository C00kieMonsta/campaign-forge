/**
 * Entities Slice
 *
 * Manages normalized storage of all domain entities.
 * Entities are stored by ID in Record<string, Entity> structures to prevent duplication
 * and enable efficient updates.
 *
 * Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 8.1, 14.1, 14.2
 */

import type {
  Client,
  DataLayer,
  EntitiesState,
  ExtractionJob,
  ExtractionResult,
  ExtractionSchema,
  Invitation,
  OrganizationMember,
  Project,
  Supplier,
  SupplierMatch
} from "@packages/types";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

/**
 * Initial state with empty normalized entity collections
 */
const initialState: EntitiesState = {
  clients: {},
  projects: {},
  dataLayers: {},
  extractionJobs: {},
  extractionResults: {},
  extractionSchemas: {},
  suppliers: {},
  organizationMembers: {},
  invitations: {},
  supplierMatches: {}
};

/**
 * Entities slice with actions for CRUD operations on normalized entities
 */
const entitiesSlice = createSlice({
  name: "entities",
  initialState,
  reducers: {
    // Client actions
    setClient: (state, action: PayloadAction<Client>) => {
      state.clients[action.payload.id] = action.payload;
    },
    setClients: (state, action: PayloadAction<Client[]>) => {
      action.payload.forEach((client) => {
        state.clients[client.id] = client;
      });
    },
    updateClient: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<Client> }>
    ) => {
      const existing = state.clients[action.payload.id];
      if (existing) {
        state.clients[action.payload.id] = {
          ...existing,
          ...action.payload.changes
        };
      }
    },
    removeClient: (state, action: PayloadAction<string>) => {
      delete state.clients[action.payload];
    },

    // Project actions
    setProject: (state, action: PayloadAction<Project>) => {
      state.projects[action.payload.id] = action.payload;
    },
    setProjects: (state, action: PayloadAction<Project[]>) => {
      action.payload.forEach((project) => {
        state.projects[project.id] = project;
      });
    },
    updateProject: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<Project> }>
    ) => {
      const existing = state.projects[action.payload.id];
      if (existing) {
        state.projects[action.payload.id] = {
          ...existing,
          ...action.payload.changes
        };
      }
    },
    removeProject: (state, action: PayloadAction<string>) => {
      delete state.projects[action.payload];
    },

    // DataLayer actions
    setDataLayer: (state, action: PayloadAction<DataLayer>) => {
      state.dataLayers[action.payload.id] = action.payload;
    },
    setDataLayers: (state, action: PayloadAction<DataLayer[]>) => {
      action.payload.forEach((dataLayer) => {
        state.dataLayers[dataLayer.id] = dataLayer;
      });
    },
    updateDataLayer: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<DataLayer> }>
    ) => {
      const existing = state.dataLayers[action.payload.id];
      if (existing) {
        state.dataLayers[action.payload.id] = {
          ...existing,
          ...action.payload.changes
        };
      }
    },
    removeDataLayer: (state, action: PayloadAction<string>) => {
      delete state.dataLayers[action.payload];
    },

    // ExtractionJob actions
    setExtractionJob: (state, action: PayloadAction<ExtractionJob>) => {
      state.extractionJobs[action.payload.id] = action.payload;
    },
    setExtractionJobs: (state, action: PayloadAction<ExtractionJob[]>) => {
      action.payload.forEach((job) => {
        state.extractionJobs[job.id] = job;
      });
    },
    updateExtractionJob: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<ExtractionJob> }>
    ) => {
      const existing = state.extractionJobs[action.payload.id];
      if (existing) {
        state.extractionJobs[action.payload.id] = {
          ...existing,
          ...action.payload.changes
        };
      }
    },
    removeExtractionJob: (state, action: PayloadAction<string>) => {
      delete state.extractionJobs[action.payload];
    },

    // ExtractionResult actions
    setExtractionResult: (state, action: PayloadAction<ExtractionResult>) => {
      state.extractionResults[action.payload.id] = action.payload;
    },
    setExtractionResults: (
      state,
      action: PayloadAction<ExtractionResult[]>
    ) => {
      action.payload.forEach((result) => {
        state.extractionResults[result.id] = result;
      });
    },
    updateExtractionResult: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<ExtractionResult> }>
    ) => {
      const existing = state.extractionResults[action.payload.id];
      if (existing) {
        state.extractionResults[action.payload.id] = {
          ...existing,
          ...action.payload.changes
        };
      }
    },
    removeExtractionResult: (state, action: PayloadAction<string>) => {
      delete state.extractionResults[action.payload];
    },

    // ExtractionSchema actions
    setExtractionSchema: (state, action: PayloadAction<ExtractionSchema>) => {
      state.extractionSchemas[action.payload.id] = action.payload;
    },
    setExtractionSchemas: (
      state,
      action: PayloadAction<ExtractionSchema[]>
    ) => {
      action.payload.forEach((schema) => {
        state.extractionSchemas[schema.id] = schema;
      });
    },
    updateExtractionSchema: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<ExtractionSchema> }>
    ) => {
      const existing = state.extractionSchemas[action.payload.id];
      if (existing) {
        state.extractionSchemas[action.payload.id] = {
          ...existing,
          ...action.payload.changes
        };
      }
    },
    removeExtractionSchema: (state, action: PayloadAction<string>) => {
      delete state.extractionSchemas[action.payload];
    },

    // Supplier actions
    setSupplier: (state, action: PayloadAction<Supplier>) => {
      state.suppliers[action.payload.id] = action.payload;
    },
    setSuppliers: (state, action: PayloadAction<Supplier[]>) => {
      action.payload.forEach((supplier) => {
        state.suppliers[supplier.id] = supplier;
      });
    },
    updateSupplier: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<Supplier> }>
    ) => {
      const existing = state.suppliers[action.payload.id];
      if (existing) {
        state.suppliers[action.payload.id] = {
          ...existing,
          ...action.payload.changes
        };
      }
    },
    removeSupplier: (state, action: PayloadAction<string>) => {
      delete state.suppliers[action.payload];
    },

    // OrganizationMember actions
    setOrganizationMember: (state, action: PayloadAction<OrganizationMember>) => {
      state.organizationMembers[action.payload.id] = action.payload;
    },
    setOrganizationMembers: (
      state,
      action: PayloadAction<OrganizationMember[]>
    ) => {
      action.payload.forEach((member) => {
        state.organizationMembers[member.id] = member;
      });
    },
    updateOrganizationMember: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<OrganizationMember> }>
    ) => {
      const existing = state.organizationMembers[action.payload.id];
      if (existing) {
        state.organizationMembers[action.payload.id] = {
          ...existing,
          ...action.payload.changes
        };
      }
    },
    removeOrganizationMember: (state, action: PayloadAction<string>) => {
      delete state.organizationMembers[action.payload];
    },

    // Invitation actions
    setInvitation: (state, action: PayloadAction<Invitation>) => {
      state.invitations[action.payload.id] = action.payload;
    },
    setInvitations: (state, action: PayloadAction<Invitation[]>) => {
      action.payload.forEach((invitation) => {
        state.invitations[invitation.id] = invitation;
      });
    },
    updateInvitation: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<Invitation> }>
    ) => {
      const existing = state.invitations[action.payload.id];
      if (existing) {
        state.invitations[action.payload.id] = {
          ...existing,
          ...action.payload.changes
        };
      }
    },
    removeInvitation: (state, action: PayloadAction<string>) => {
      delete state.invitations[action.payload];
    },

    // SupplierMatch actions
    setSupplierMatch: (state, action: PayloadAction<SupplierMatch>) => {
      state.supplierMatches[action.payload.id] = action.payload;
    },
    setSupplierMatches: (state, action: PayloadAction<SupplierMatch[]>) => {
      action.payload.forEach((match) => {
        state.supplierMatches[match.id] = match;
      });
    },
    updateSupplierMatch: (
      state,
      action: PayloadAction<{ id: string; changes: Partial<SupplierMatch> }>
    ) => {
      const existing = state.supplierMatches[action.payload.id];
      if (existing) {
        state.supplierMatches[action.payload.id] = {
          ...existing,
          ...action.payload.changes
        };
      }
    },
    removeSupplierMatch: (state, action: PayloadAction<string>) => {
      delete state.supplierMatches[action.payload];
    },

    // Batch operations
    clearAllEntities: (state) => {
      state.clients = {};
      state.projects = {};
      state.dataLayers = {};
      state.extractionJobs = {};
      state.extractionResults = {};
      state.extractionSchemas = {};
      state.suppliers = {};
      state.organizationMembers = {};
      state.invitations = {};
      state.supplierMatches = {};
    }
  }
});

export const {
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
  // DataLayer actions
  setDataLayer,
  setDataLayers,
  updateDataLayer,
  removeDataLayer,
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
  // OrganizationMember actions
  setOrganizationMember,
  setOrganizationMembers,
  updateOrganizationMember,
  removeOrganizationMember,
  // Invitation actions
  setInvitation,
  setInvitations,
  updateInvitation,
  removeInvitation,
  // SupplierMatch actions
  setSupplierMatch,
  setSupplierMatches,
  updateSupplierMatch,
  removeSupplierMatch,
  // Batch operations
  clearAllEntities
} = entitiesSlice.actions;

export default entitiesSlice.reducer;
