/**
 * Drafts Slice
 *
 * Manages unsaved form data for optimistic updates and form state.
 * Allows users to work on forms without immediately persisting changes.
 *
 * Requirements: 8.3, 14.1, 14.2
 */

import type { Client, DraftsState, Project, Supplier } from "@packages/types";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

/**
 * Initial drafts state with no active drafts
 */
const initialState: DraftsState = {
  newClient: null,
  newProject: null,
  newSupplier: null,
  editingClient: null,
  editingProject: null,
  editingSupplier: null
};

/**
 * Drafts slice with actions for managing unsaved form data
 */
const draftsSlice = createSlice({
  name: "drafts",
  initialState,
  reducers: {
    // New entity draft actions
    setNewClientDraft: (state, action: PayloadAction<Partial<Client>>) => {
      state.newClient = action.payload;
    },
    updateNewClientDraft: (state, action: PayloadAction<Partial<Client>>) => {
      state.newClient = state.newClient
        ? { ...state.newClient, ...action.payload }
        : action.payload;
    },
    clearNewClientDraft: (state) => {
      state.newClient = null;
    },

    setNewProjectDraft: (state, action: PayloadAction<Partial<Project>>) => {
      state.newProject = action.payload;
    },
    updateNewProjectDraft: (state, action: PayloadAction<Partial<Project>>) => {
      state.newProject = state.newProject
        ? { ...state.newProject, ...action.payload }
        : action.payload;
    },
    clearNewProjectDraft: (state) => {
      state.newProject = null;
    },

    setNewSupplierDraft: (state, action: PayloadAction<Partial<Supplier>>) => {
      state.newSupplier = action.payload;
    },
    updateNewSupplierDraft: (
      state,
      action: PayloadAction<Partial<Supplier>>
    ) => {
      state.newSupplier = state.newSupplier
        ? { ...state.newSupplier, ...action.payload }
        : action.payload;
    },
    clearNewSupplierDraft: (state) => {
      state.newSupplier = null;
    },

    // Editing entity draft actions
    setEditingClientDraft: (
      state,
      action: PayloadAction<{ id: string; draft: Partial<Client> }>
    ) => {
      state.editingClient = action.payload;
    },
    updateEditingClientDraft: (
      state,
      action: PayloadAction<Partial<Client>>
    ) => {
      if (state.editingClient) {
        state.editingClient.draft = {
          ...state.editingClient.draft,
          ...action.payload
        };
      }
    },
    clearEditingClientDraft: (state) => {
      state.editingClient = null;
    },

    setEditingProjectDraft: (
      state,
      action: PayloadAction<{ id: string; draft: Partial<Project> }>
    ) => {
      state.editingProject = action.payload;
    },
    updateEditingProjectDraft: (
      state,
      action: PayloadAction<Partial<Project>>
    ) => {
      if (state.editingProject) {
        state.editingProject.draft = {
          ...state.editingProject.draft,
          ...action.payload
        };
      }
    },
    clearEditingProjectDraft: (state) => {
      state.editingProject = null;
    },

    setEditingSupplierDraft: (
      state,
      action: PayloadAction<{ id: string; draft: Partial<Supplier> }>
    ) => {
      state.editingSupplier = action.payload;
    },
    updateEditingSupplierDraft: (
      state,
      action: PayloadAction<Partial<Supplier>>
    ) => {
      if (state.editingSupplier) {
        state.editingSupplier.draft = {
          ...state.editingSupplier.draft,
          ...action.payload
        };
      }
    },
    clearEditingSupplierDraft: (state) => {
      state.editingSupplier = null;
    },

    // Clear all drafts
    clearAllDrafts: () => initialState
  }
});

export const {
  // New entity draft actions
  setNewClientDraft,
  updateNewClientDraft,
  clearNewClientDraft,
  setNewProjectDraft,
  updateNewProjectDraft,
  clearNewProjectDraft,
  setNewSupplierDraft,
  updateNewSupplierDraft,
  clearNewSupplierDraft,
  // Editing entity draft actions
  setEditingClientDraft,
  updateEditingClientDraft,
  clearEditingClientDraft,
  setEditingProjectDraft,
  updateEditingProjectDraft,
  clearEditingProjectDraft,
  setEditingSupplierDraft,
  updateEditingSupplierDraft,
  clearEditingSupplierDraft,
  // Clear all
  clearAllDrafts
} = draftsSlice.actions;

export default draftsSlice.reducer;
